(() => {
  const STATE_KEY = "open_player_settings_v18";

  function isPopoutMode() { return window.location.hash === "#popout"; }
  function isMobileDevice() {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod|Android/i.test(ua) || (window.matchMedia?.("(pointer: coarse)")?.matches && window.matchMedia?.("(max-width: 820px)")?.matches);
  }

  function loadState() { const raw = localStorage.getItem(STATE_KEY); return raw ? JSON.parse(raw) : null; }
  function saveState(state) { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {} }

  function readControls() {
    return {
      songDuration: document.getElementById("songDuration")?.value ?? "60",
      tone: document.getElementById("tone")?.value ?? "110",
      updatedAt: Date.now()
    };
  }

  function applyControls(state) {
    const sd = document.getElementById("songDuration");
    const tone = document.getElementById("tone");
    const hzReadout = document.getElementById("hzReadout");
    if (sd) sd.value = state?.songDuration || "60";
    let toneVal = state?.tone ? Math.max(30, Math.min(200, Number(state.tone))) : 110;
    if (tone) tone.value = String(toneVal);
    if (hzReadout) hzReadout.textContent = String(toneVal);
  }

  function setButtonState(state) {
    const playBtn = document.getElementById("playNow");
    const stopBtn = document.getElementById("stop");
    if (!playBtn || !stopBtn) return;
    playBtn.classList.toggle("filled", state === "playing");
    stopBtn.classList.toggle("filled", state !== "playing");
  }

  // =========================
  // AUDIO ENGINE (Hi-Fi)
  // =========================
  let audioContext = null, masterGain = null, reverbNode = null, streamDest = null, heartbeat = null;
  let activeNodes = [], isPlaying = false, isEndingNaturally = false;
  let nextNoteTime = 0, sessionStartTime = 0, timerInterval = null;
  
  // FIX 3: LOGIC STATE (The "Brain")
  let lastNoteIndex = 3; // Start in the middle of the scale
  let driftDirection = 1; // Tendency to move up or down

  const scheduleAheadTime = 0.5, NATURAL_END_FADE_SEC = 1.2, NATURAL_END_HOLD_SEC = 0.35;
  const scales = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], pentatonic: [0, 2, 4, 7, 9] };
  let runMood = "major", runDensity = 0.2;

  function ensureAudio() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    streamDest = audioContext.createMediaStreamDestination();
    masterGain = audioContext.createGain();
    
    // STRICT GAIN STAGING: No compression allowed, so we lower the master slightly 
    // to accommodate the richer, multi-oscillator voices.
    masterGain.gain.value = 0.8; 
    
    masterGain.connect(streamDest);
    masterGain.connect(audioContext.destination);

    const silentBuffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
    heartbeat = audioContext.createBufferSource();
    heartbeat.buffer = silentBuffer;
    heartbeat.loop = true;
    heartbeat.start();
    heartbeat.connect(audioContext.destination);

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Open', artist: 'Stereo Images' });
      navigator.mediaSession.setActionHandler('play', startFromUI);
      navigator.mediaSession.setActionHandler('pause', stopAllManual);
    }
    
    let videoWakeLock = document.querySelector('video');
    if (!videoWakeLock) {
        videoWakeLock = document.createElement('video');
        Object.assign(videoWakeLock.style, { position: 'fixed', bottom: '0', right: '0', width: '1px', height: '1px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' });
        videoWakeLock.setAttribute('playsinline', '');
        videoWakeLock.setAttribute('muted', '');
        document.body.appendChild(videoWakeLock);
    }
    videoWakeLock.srcObject = streamDest.stream;
    videoWakeLock.play().catch(() => {});

    createHighQualityReverb();
  }

  // FIX 2: ATMOSPHERE (Damped Reverb via Offline Rendering)
  function createHighQualityReverb() {
    const lengthSec = 4.0;
    const sampleRate = audioContext.sampleRate;
    const lengthSamples = sampleRate * lengthSec;

    // Use OfflineAudioContext to render the Impulse Response (IR)
    // This allows us to process the noise through a filter *before* using it.
    const offlineCtx = new OfflineAudioContext(2, lengthSamples, sampleRate);

    const noiseBuffer = offlineCtx.createBuffer(2, lengthSamples, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = noiseBuffer.getChannelData(ch);
      for (let i = 0; i < lengthSamples; i++) {
        // Exponential decay envelope on the raw noise
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / lengthSamples, 2.5);
      }
    }

    const source = offlineCtx.createBufferSource();
    source.buffer = noiseBuffer;

    // The Filter: Simulates air absorption
    const filter = offlineCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(15000, 0); // Start Bright
    filter.frequency.exponentialRampToValueAtTime(300, lengthSec); // End Dark

    source.connect(filter);
    filter.connect(offlineCtx.destination);
    source.start();

    // Render the IR
    offlineCtx.startRendering().then((renderedBuffer) => {
      reverbNode = audioContext.createConvolver();
      reverbNode.buffer = renderedBuffer;
      
      const reverbGain = audioContext.createGain();
      reverbGain.gain.value = 1.2; // Compensate for the energy lost by filtering
      
      reverbNode.connect(reverbGain);
      reverbGain.connect(masterGain); // Route to master
    });
  }

  // FIX 1: RICHNESS (Dual-Oscillator Voices)
  function playFmBell(freq, duration, volume, startTime) {
    if (!reverbNode) return; // Wait for IR to render

    // We use TWO carriers:
    // 1. Sine (Fundamental, Pure)
    // 2. Triangle (Warmth, Odd Harmonics, Detuned)
    const carrierSine = audioContext.createOscillator();
    const carrierTri = audioContext.createOscillator();
    const modulator = audioContext.createOscillator();

    const modGain = audioContext.createGain();
    const ampGain = audioContext.createGain();

    carrierSine.type = 'sine';
    carrierTri.type = 'triangle';
    modulator.type = 'sine';

    // Detuning for "Chorus" Effect (Richness)
    carrierSine.frequency.value = freq;
    carrierTri.frequency.value = freq;
    carrierTri.detune.value = 4; // +4 cents detune for subtle beating

    // FM Ratios (Non-integer ratios = Bell-like inharmonics)
    const ratio = 1.4 + Math.random() * 0.2; 
    modulator.frequency.value = freq * ratio;
    
    // FM Depth
    const modIndex = 150 + Math.random() * 100;
    modGain.gain.setValueAtTime(modIndex, startTime);
    modGain.gain.exponentialRampToValueAtTime(1, startTime + duration * 0.8);

    // Amplitude Envelope (No compression, just careful curves)
    // We scale volume down by 0.6 because we now have 2 oscillators summing together
    const safeVol = volume * 0.6; 
    
    ampGain.gain.setValueAtTime(0, startTime);
    ampGain.gain.linearRampToValueAtTime(safeVol, startTime + 0.02); // Soft attack
    ampGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    // Routing
    modulator.connect(modGain);
    
    // Modulate BOTH carriers
    modGain.connect(carrierSine.frequency);
    modGain.connect(carrierTri.frequency);

    carrierSine.connect(ampGain);
    carrierTri.connect(ampGain);

    ampGain.connect(reverbNode);
    ampGain.connect(masterGain);

    // Timing
    const stopTime = startTime + duration + 0.1;
    [carrierSine, carrierTri, modulator].forEach(node => {
        node.start(startTime);
        node.stop(stopTime);
    });

    activeNodes.push(carrierSine, carrierTri, modulator, modGain, ampGain);
    if (activeNodes.length > 250) activeNodes.splice(0, 100);
  }

  // FIX 3: INTENT (Markov Chain / Random Walk)
  function getNextNote(baseFreq) {
    const scale = scales[runMood] || scales.major;
    const len = scale.length;

    // "Lazy" Probability:
    // 50% chance: Step +/- 1 index
    // 30% chance: Step +/- 2 indices
    // 20% chance: Jump anywhere
    const r = Math.random();
    let shift = 0;

    if (r < 0.5) shift = (Math.random() < 0.5 ? -1 : 1);
    else if (r < 0.8) shift = (Math.random() < 0.5 ? -2 : 2);
    else shift = Math.floor(Math.random() * len) - lastNoteIndex;

    // Apply drift tendency
    if (Math.random() < 0.1) driftDirection *= -1; // Occasionally change intent
    if (Math.random() < 0.3) shift += driftDirection; 

    let newIndex = lastNoteIndex + shift;

    // Wrap around octaves (keep it constrained to 2 octaves mostly)
    // We effectively clamp the index to keep it "musical"
    if (newIndex < 0) newIndex = Math.abs(newIndex);
    if (newIndex >= len * 2) newIndex = len * 2 - (newIndex % len);
    
    lastNoteIndex = newIndex;

    // Calculate Freq
    // We map the index to the scale, adding octaves for higher indices
    const octave = Math.floor(newIndex / len);
    const noteDegree = newIndex % len;
    const interval = scale[noteDegree];
    
    return baseFreq * Math.pow(2, (interval / 12) + octave);
  }

  function scheduler() {
    if (!isPlaying) return;
    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    if (durationInput !== "infinite" && (audioContext.currentTime - sessionStartTime) >= parseFloat(durationInput)) {
      beginNaturalEnd(); return;
    }
    while (nextNoteTime < audioContext.currentTime + scheduleAheadTime) {
      const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
      
      // Use the "Brain" to pick the note
      const freq = getNextNote(baseFreq);
      
      // Slower, more deliberate pacing (Feldman-esque)
      const dur = (1 / runDensity) * 3.5; 
      
      playFmBell(freq, dur, 0.3, nextNoteTime);
      
      // Allow for "negative space" (silence)
      const space = (1 / runDensity) * (1.0 + Math.random() * 0.5);
      nextNoteTime += space;
    }
  }

  function killImmediate() {
    if (timerInterval) clearInterval(timerInterval);
    activeNodes.forEach(n => { try { n.stop(); } catch (e) {} });
    activeNodes = []; isPlaying = isEndingNaturally = false;
    if (masterGain) { masterGain.gain.cancelScheduledValues(audioContext.currentTime); masterGain.gain.setValueAtTime(0.8, audioContext.currentTime); }
  }

  async function startFromUI() {
    ensureAudio();
    if (audioContext.state === "suspended") await audioContext.resume();
    runMood = ["major", "minor", "pentatonic"][Math.floor(Math.random() * 3)];
    runDensity = 0.05 + Math.random() * 0.30; // Slightly sparser for "Open" feel
    killImmediate();
    isPlaying = true; setButtonState("playing");
    sessionStartTime = nextNoteTime = audioContext.currentTime;
    timerInterval = setInterval(scheduler, 100); 
  }

  function stopAllManual() {
    setButtonState("stopped");
    if (!audioContext) { isPlaying = false; return; }
    isPlaying = isEndingNaturally = false;
    if (timerInterval) clearInterval(timerInterval);
    masterGain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
    setTimeout(killImmediate, 120);
  }

  function beginNaturalEnd() {
    if (isEndingNaturally) return;
    isEndingNaturally = true; isPlaying = false;
    if (timerInterval) clearInterval(timerInterval);
    masterGain.gain.setValueAtTime(masterGain.gain.value, audioContext.currentTime + NATURAL_END_HOLD_SEC);
    masterGain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + NATURAL_END_HOLD_SEC + NATURAL_END_FADE_SEC);
    setTimeout(() => { killImmediate(); setButtonState("stopped"); }, (NATURAL_END_HOLD_SEC + NATURAL_END_FADE_SEC + 0.1) * 1000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (isPopoutMode()) {
        document.body.classList.add("popout");
        applyControls(loadState());
        document.getElementById("tone").addEventListener("input", (e) => {
            document.getElementById("hzReadout").textContent = e.target.value;
            saveState(readControls());
        });
        document.getElementById("songDuration").addEventListener("change", () => saveState(readControls()));
        document.getElementById("playNow").onclick = startFromUI;
        document.getElementById("stop").onclick = stopAllManual;
        setButtonState("stopped");
    }
    document.getElementById("launchPlayer")?.addEventListener("click", () => {
      if (!isPopoutMode() && isMobileDevice()) {
        document.body.classList.add("mobile-player");
        applyControls(loadState());
        document.getElementById("tone").addEventListener("input", (e) => {
            document.getElementById("hzReadout").textContent = e.target.value;
            saveState(readControls());
        });
        document.getElementById("playNow").onclick = startFromUI;
        document.getElementById("stop").onclick = stopAllManual;
      } else {
        window.open(`${window.location.href.split("#")[0]}#popout`, "open_player", "width=500,height=680,resizable=yes");
      }
    });
  });
})();
