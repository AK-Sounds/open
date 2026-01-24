(() => {
  const STATE_KEY = "open_player_final_v61";

  // =========================
  // UTILITIES & UI
  // =========================
  function isPopoutMode() { return window.location.hash === "#popout"; }
  function isMobileDevice() {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod|Android/i.test(ua) || (window.matchMedia?.("(pointer: coarse)")?.matches && window.matchMedia?.("(max-width: 820px)")?.matches);
  }

  function loadState() {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
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

    if (sd) {
      const allowed = new Set(["60", "300", "600", "1800", "infinite"]);
      const v = state?.songDuration != null ? String(state.songDuration) : "60";
      sd.value = allowed.has(v) ? v : "60";
    }

    let toneVal = 110;
    if (state?.tone != null) {
      const n = Number(state.tone);
      if (Number.isFinite(n)) toneVal = n;
    }
    toneVal = Math.max(30, Math.min(200, toneVal));

    if (tone) tone.value = String(toneVal);
    if (hzReadout) hzReadout.textContent = String(toneVal);
  }

  function setButtonState(state) {
    const playBtn = document.getElementById("playNow");
    const stopBtn = document.getElementById("stop");
    const toneInput = document.getElementById("tone");

    if (!playBtn || !stopBtn) return;

    playBtn.classList.toggle("filled", state === "playing");
    stopBtn.classList.toggle("filled", state !== "playing");

    if (toneInput) toneInput.disabled = (state === "playing");
  }

  // =========================
  // AUDIO ENGINE (v27 Exact)
  // =========================
  function createReverbBuffer(ctx) {
    const duration = 5.0, decay = 1.5, rate = ctx.sampleRate, length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return impulse;
  }

  function scheduleNote(ctx, destination, freq, time, duration, volume, reverbBuffer) {
    const numVoices = 2 + Math.floor(Math.random() * 2);
    let totalAmp = 0;
    
    const conv = ctx.createConvolver();
    conv.buffer = reverbBuffer;
    const revGain = ctx.createGain();
    revGain.gain.value = 1.5; 
    conv.connect(revGain);
    revGain.connect(destination);

    const voices = Array.from({length: numVoices}, () => {
      const v = { 
          modRatio: 1.5 + Math.random() * 2.5, 
          modIndex: 1 + Math.random() * 4, 
          amp: Math.random() 
      };
      totalAmp += v.amp;
      return v;
    });

    voices.forEach(voice => {
      const carrier = ctx.createOscillator();
      const modulator = ctx.createOscillator();
      const modGain = ctx.createGain();
      const ampGain = ctx.createGain();

      carrier.type = 'sine';
      modulator.type = 'sine';

      carrier.frequency.value = freq + (Math.random() - 0.5) * 2;
      modulator.frequency.value = freq * voice.modRatio;

      modGain.gain.setValueAtTime(freq * voice.modIndex, time);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.5, time + duration);

      ampGain.gain.setValueAtTime(0.0001, time);
      ampGain.gain.exponentialRampToValueAtTime((voice.amp / totalAmp) * volume, time + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      modulator.connect(modGain); 
      modGain.connect(carrier.frequency);
      
      carrier.connect(ampGain); 
      ampGain.connect(conv); 
      ampGain.connect(destination);

      modulator.start(time); carrier.start(time);
      modulator.stop(time + duration); carrier.stop(time + duration);
    });
  }

  // ==========================================
  // THE SHADOW WALKER (Minor-Biased Logic)
  // ==========================================
  
  let circlePosition = 0; 
  let isMinor = false; 

  function getScaleNote(baseFreq, scaleIndex, circlePos, minorMode) {
    let pos = circlePos % 12;
    if (pos < 0) pos += 12;

    let semitones = (pos * 7) % 12;
    let rootOffset = semitones;
    
    // Relative Minor shift
    if (minorMode) {
        rootOffset = (semitones + 9) % 12; 
    }

    const intervals = minorMode 
        ? [0, 2, 3, 5, 7, 8, 10] // Natural Minor
        : [0, 2, 4, 5, 7, 9, 11]; // Major

    const len = intervals.length;
    const octave = Math.floor(scaleIndex / len);
    const degree = ((scaleIndex % len) + len) % len;
    
    const noteValue = rootOffset + intervals[degree] + (octave * 12);
    return baseFreq * Math.pow(2, noteValue / 12);
  }

  // MINOR GRAVITY LOGIC
  function updateHarmonyState() {
      const r = Math.random();
      
      if (!isMinor) {
          // WE ARE MAJOR (Unstable)
          // 80% Chance -> Sink into Relative Minor
          // 20% Chance -> Move Circle (Stay Major)
          if (r < 0.8) {
              isMinor = true;
              console.log(`Modulating: Sinking to Relative Minor`);
          } else {
              const dir = Math.random() < 0.9 ? 1 : -1;
              circlePosition += dir;
              console.log(`Modulating: Circle Step (Major)`);
          }
      } else {
          // WE ARE MINOR (Stable)
          // 30% Chance -> Surface to Relative Major
          // 70% Chance -> Move Circle (Stay Minor)
          if (r < 0.3) {
              isMinor = false;
              console.log(`Modulating: Surfacing to Relative Major`);
          } else {
              const dir = Math.random() < 0.9 ? 1 : -1;
              circlePosition += dir;
              console.log(`Modulating: Circle Step (Minor)`);
          }
      }
  }

  function getDynamicDensity(elapsed) {
      const period = 60; 
      const sine = Math.sin((elapsed / period) * 2 * Math.PI);
      const normalized = (sine + 1) / 2; 
      return 0.08 + (normalized * 0.12);
  }

  // =========================
  // SCHEDULER
  // =========================
  let audioContext = null, masterGain = null, streamDest = null;
  let liveReverbBuffer = null;
  let isPlaying = false, isEndingNaturally = false, isApproachingEnd = false;
  let nextTimeA = 0;
  let patternIdxA = 0; 
  let notesSinceModulation = 0;
  let sessionStartTime = 0, timerInterval = null;

  function ensureAudio() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    streamDest = audioContext.createMediaStreamDestination();
    masterGain = audioContext.createGain();

    masterGain.connect(streamDest);
    masterGain.connect(audioContext.destination);

    const silentBuffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
    const heartbeat = audioContext.createBufferSource();
    heartbeat.buffer = silentBuffer;
    heartbeat.loop = true;
    heartbeat.start();
    heartbeat.connect(audioContext.destination);

    liveReverbBuffer = createReverbBuffer(audioContext);

    let videoWakeLock = document.querySelector('video');
    if (!videoWakeLock) {
      videoWakeLock = document.createElement('video');
      Object.assign(videoWakeLock.style, {
        position: 'fixed', bottom: '0', right: '0',
        width: '1px', height: '1px',
        opacity: '0.01', pointerEvents: 'none', zIndex: '-1'
      });
      videoWakeLock.setAttribute('playsinline', '');
      videoWakeLock.setAttribute('muted', '');
      document.body.appendChild(videoWakeLock);
    }
    videoWakeLock.srcObject = streamDest.stream;
    videoWakeLock.play().catch(() => {});

    setupKeyboardShortcuts();
  }

  function scheduler() {
    if (!isPlaying) return;
    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const now = audioContext.currentTime;
    const elapsed = now - sessionStartTime;

    if (durationInput !== "infinite") {
      const targetDuration = parseFloat(durationInput);
      if (elapsed >= targetDuration) isApproachingEnd = true;
    }

    const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
    const density = getDynamicDensity(elapsed);
    const noteDur = (1 / density) * 2.5;

    while (nextTimeA < now + 0.5) {
      if (isApproachingEnd && !isEndingNaturally) {
        // End condition: C Major (Home) + Root Note
        const pos = circlePosition % 12;
        const isHomeKey = (pos === 0) && (!isMinor);
        const isRootNote = (patternIdxA % 7 === 0);

        if (isHomeKey && isRootNote) {
           const freq = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor);
           scheduleNote(audioContext, masterGain, freq, nextTimeA, 25.0, 0.4, liveReverbBuffer);
           beginNaturalEnd();
           return;
        }
      }

      // SLOWER PACING:
      // Wait for 18 notes (instead of 10) before considering a change
      // Low probability (15%) per check
      if (notesSinceModulation > 18 && Math.random() < 0.15) {
          updateHarmonyState();
          notesSinceModulation = 0;
      }

      const r = Math.random();
      let shift = 0;
      if (r < 0.4) shift = 1;
      else if (r < 0.8) shift = -1;
      else shift = (Math.random() < 0.5 ? 2 : -2);
      
      patternIdxA += shift;
      if (patternIdxA > 6) patternIdxA = 6;
      if (patternIdxA < -4) patternIdxA = -4;

      const freq = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor);
      
      scheduleNote(audioContext, masterGain, freq, nextTimeA, noteDur, 0.4, liveReverbBuffer);
      
      notesSinceModulation++;
      nextTimeA += (1 / density);
    }
  }

  function killImmediate() {
    if (timerInterval) clearInterval(timerInterval);
    if (masterGain) { 
        masterGain.gain.cancelScheduledValues(audioContext.currentTime); 
        masterGain.gain.setValueAtTime(1, audioContext.currentTime); 
    }
    isPlaying = false;
  }

  function stopAllManual() {
    setButtonState("stopped");
    if (!audioContext) { isPlaying = false; return; }

    isPlaying = false;
    isEndingNaturally = false;

    if (timerInterval) clearInterval(timerInterval);

    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    setTimeout(killImmediate, 120);
  }

  function beginNaturalEnd() {
    if (isEndingNaturally) return;
    isEndingNaturally = true; isPlaying = false;
    if (timerInterval) clearInterval(timerInterval);
    
    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 8.0);

    setTimeout(() => {
      killImmediate();
      setButtonState("stopped");
    }, 8100);
  }

  async function startFromUI() {
    ensureAudio();
    if (audioContext.state === "suspended") await audioContext.resume();

    masterGain.gain.cancelScheduledValues(audioContext.currentTime);
    masterGain.gain.setValueAtTime(1, audioContext.currentTime);

    nextTimeA = audioContext.currentTime;
    patternIdxA = 0; 
    circlePosition = 0; 
    isMinor = false; 
    notesSinceModulation = 0;

    isEndingNaturally = false; isApproachingEnd = false;

    killImmediate();
    isPlaying = true;
    setButtonState("playing");
    sessionStartTime = audioContext.currentTime;

    timerInterval = setInterval(scheduler, 100);
  }

  // =========================
  // WAV EXPORT
  // =========================
  async function renderWavExport() {
    if (!isPlaying && !audioContext) { alert("Please start playback first."); return; }

    console.log("Rendering Studio Export...");
    const sampleRate = 44100;
    const duration = 75;
    const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    const offlineMaster = offlineCtx.createGain();
    offlineMaster.connect(offlineCtx.destination);
    const offlineReverbBuffer = createReverbBuffer(offlineCtx);

    const now = audioContext.currentTime;
    const elapsed = now - sessionStartTime;
    const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
    const density = getDynamicDensity(elapsed);
    const noteDur = (1 / density) * 2.5;

    let localCircle = circlePosition;
    let localMinor = isMinor;
    let localIdx = patternIdxA;
    let localTime = 0;
    let localModCount = 0;

    while (localTime < 60) {
       // Offline logic duplicate
       if (localModCount > 18 && Math.random() < 0.15) {
          const r = Math.random();
          if (!localMinor) {
              if (r < 0.8) localMinor = true;
              else localCircle += (Math.random() < 0.9 ? 1 : -1);
          } else {
              if (r < 0.3) localMinor = false;
              else localCircle += (Math.random() < 0.9 ? 1 : -1);
          }
          localModCount = 0;
       }

       const r = Math.random();
       let shift = 0;
       if (r < 0.4) shift = 1; else if (r < 0.8) shift = -1; else shift = (Math.random() < 0.5 ? 2 : -2);
       localIdx += shift;
       if (localIdx > 6) localIdx = 6; if (localIdx < -4) localIdx = -4;

       const freq = getScaleNote(baseFreq, localIdx, localCircle, localMinor);
       scheduleNote(offlineCtx, offlineMaster, freq, localTime, noteDur, 0.4, offlineReverbBuffer);
       
       localModCount++;
       localTime += (1 / density);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = bufferToWave(renderedBuffer, duration * sampleRate);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `open-shadow-v61-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 100);
  }

  function bufferToWave(abuffer, len) {
    const numOfChan = abuffer.numberOfChannels, length = len * numOfChan * 2 + 44, buffer = new ArrayBuffer(length), view = new DataView(buffer), channels = [], sampleRate = abuffer.sampleRate;
    let offset = 0, pos = 0;
    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }
    setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan); setUint32(sampleRate); setUint32(sampleRate * 2 * numOfChan); setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);
    for (let i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));
    while (pos < length) {
      for (let i = 0; i < numOfChan; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(pos, sample, true); pos += 2;
      }
      offset++;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'r') { renderWavExport(); }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (isPopoutMode()) {
      document.body.classList.add("popout");
      applyControls(loadState());

      document.getElementById("tone")?.addEventListener("input", (e) => {
        document.getElementById("hzReadout").textContent = e.target.value;
        saveState(readControls());
      });

      document.getElementById("songDuration")?.addEventListener("change", () => saveState(readControls()));

      document.getElementById("playNow").onclick = startFromUI;
      document.getElementById("stop").onclick = stopAllManual;

      setButtonState("stopped");
    }

    document.getElementById("launchPlayer")?.addEventListener("click", () => {
      if (!isPopoutMode() && isMobileDevice()) {
        document.body.classList.add("mobile-player");
        applyControls(loadState());

        document.getElementById("tone")?.addEventListener("input", (e) => {
          document.getElementById("hzReadout").textContent = e.target.value;
          saveState(readControls());
        });

        document.getElementById("songDuration")?.addEventListener("change", () => saveState(readControls()));

        document.getElementById("playNow").onclick = startFromUI;
        document.getElementById("stop").onclick = stopAllManual;

        setButtonState("stopped");
      } else {
        window.open(
          `${window.location.href.split("#")[0]}#popout`,
          "open_player",
          "width=500,height=680,resizable=yes"
        );
      }
    });
  });
})();
