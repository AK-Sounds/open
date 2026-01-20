(() => {
  const STATE_KEY = "open_player_settings_v16";

  function isPopoutMode() {
    return window.location.hash === "#popout";
  }

  // Mobile heuristic: iOS/Android OR coarse pointer + small viewport.
  function isMobileDevice() {
    const ua = navigator.userAgent || "";
    const uaMobile = /iPhone|iPad|iPod|Android/i.test(ua);
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
    const small = window.matchMedia?.("(max-width: 820px)")?.matches ?? false;
    return uaMobile || (coarse && small);
  }

  function isPlayerMode() {
    // “player mode” means controls are visible and audio is allowed:
    // popout OR mobile one-page
    return isPopoutMode() || document.body.classList.contains("mobile-player");
  }

  function safeParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }

  function loadState() {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? safeParse(raw) : null;
  }

  function saveState(state) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  }

  function readControls() {
    return {
      songDuration: document.getElementById("songDuration")?.value ?? "60",
      tone: document.getElementById("tone")?.value ?? "110",
      updatedAt: Date.now()
    };
  }

  function applyControls(state) {
    if (!state) return;

    const sd = document.getElementById("songDuration");
    const tone = document.getElementById("tone");
    const hzReadout = document.getElementById("hzReadout");

    if (sd && state.songDuration != null) sd.value = state.songDuration;

    if (tone && state.tone != null) {
      tone.value = state.tone;
      if (hzReadout) hzReadout.textContent = state.tone;
    }
  }

  // =========================
  // Button UI state (.filled)
  // =========================
  function setButtonsPlaying(playing) {
    const playBtn = document.getElementById("playNow");
    const stopBtn = document.getElementById("stop");
    if (!playBtn || !stopBtn) return;

    if (playing) {
      playBtn.classList.add("filled");   // black
      stopBtn.classList.remove("filled"); // white
    } else {
      playBtn.classList.remove("filled"); // white
      stopBtn.classList.add("filled");    // black
    }
  }

  // =========================
  // Launch logic
  // =========================
  function openPopout() {
    const base = window.location.href.split("#")[0];
    const url = `${base}#popout`;

    const w = window.open(
      url,
      "open_popout_player",
      "width=480,height=620,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes"
    );

    if (!w) {
      alert("Pop-up blocked. Please allow pop-ups for this site, then try again.");
      return;
    }
    try { w.focus(); } catch {}
  }

  function enterMobileOnePageMode() {
    document.body.classList.add("mobile-player");
    // If user is already in player mode, make sure initial button state is correct.
    setButtonsPlaying(false);
  }

  // =========================
  // Audio engine (player mode)
  // =========================
  let audioContext = null;
  let masterGain = null;
  let reverbNode = null;
  let reverbGain = null;

  let activeNodes = [];
  let isPlaying = false;
  let nextNoteTime = 0;
  let sessionStartTime = 0;
  let rafId = null;

  const scheduleAheadTime = 0.5;

  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
  };

  // Hidden params (as you already had)
  const MOOD_CHOICES = ["major", "minor", "pentatonic"];
  const DENSITY_MIN = 0.05;
  const DENSITY_MAX = 0.425;

  let runMood = "major";
  let runDensity = 0.2;

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function randFloat(min, max) {
    return min + Math.random() * (max - min);
  }
  function rerollHiddenParamsForThisPlay() {
    runMood = pick(MOOD_CHOICES);
    runDensity = randFloat(DENSITY_MIN, DENSITY_MAX);
  }

  function ensureAudio() {
    if (audioContext) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
    masterGain.gain.value = 1;

    // Reverb (unchanged from your current v16)
    reverbNode = audioContext.createConvolver();
    reverbGain = audioContext.createGain();
    reverbGain.gain.value = 1.5;

    createReverb();
  }

  function createReverb() {
    const duration = 5.0;
    const decay = 1.5;
    const rate = audioContext.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = audioContext.createBuffer(2, length, rate);

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }

    reverbNode.buffer = impulse;
    reverbNode.connect(reverbGain);
    reverbGain.connect(audioContext.destination);
  }

  function playFmBell(freq, duration, volume, startTime) {
    const numVoices = 2 + Math.floor(Math.random() * 2);
    const voices = [];
    let totalAmp = 0;

    for (let i = 0; i < numVoices; i++) {
      const modRatio = 1.5 + Math.random() * 2.5;
      const modIndex = 1 + Math.random() * 4;
      const amp = Math.random();
      voices.push({ modRatio, modIndex, amp });
      totalAmp += amp;
    }

    voices.forEach((voice) => {
      const carrier = audioContext.createOscillator();
      const modulator = audioContext.createOscillator();
      const modGain = audioContext.createGain();
      const ampGain = audioContext.createGain();

      // Micro-detune
      const detune = (Math.random() - 0.5) * 2.0;
      carrier.frequency.value = freq + detune;

      modulator.frequency.value = freq * voice.modRatio;

      const maxDeviation = freq * voice.modIndex;
      const minDeviation = freq * 0.5; // keep some wobble

      modGain.gain.setValueAtTime(maxDeviation, startTime);
      modGain.gain.exponentialRampToValueAtTime(minDeviation, startTime + duration);

      ampGain.gain.setValueAtTime(0.0001, startTime);
      ampGain.gain.exponentialRampToValueAtTime((voice.amp / totalAmp) * volume, startTime + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(ampGain);

      ampGain.connect(reverbNode);
      ampGain.connect(masterGain);

      modulator.start(startTime);
      carrier.start(startTime);

      modulator.stop(startTime + duration);
      carrier.stop(startTime + duration);

      activeNodes.push(carrier, modulator, modGain, ampGain);
    });

    if (activeNodes.length > 250) activeNodes.splice(0, 120);
  }

  function scheduler() {
    if (!isPlaying) return;

    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const currentTime = audioContext.currentTime;

    if (durationInput !== "infinite") {
      const elapsed = currentTime - sessionStartTime;
      if (elapsed >= parseFloat(durationInput)) {
        stopAll();
        return;
      }
    }

    while (nextNoteTime < currentTime + scheduleAheadTime) {
      const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");

      const scale = scales[runMood] || scales.major;
      const interval = scale[Math.floor(Math.random() * scale.length)];
      const freq = baseFreq * Math.pow(2, interval / 12);

      const density = runDensity;
      const dur = (1 / density) * 2.5;

      playFmBell(freq, dur, 0.4, nextNoteTime);

      const drift = 0.95 + (Math.random() * 0.1);
      nextNoteTime += (1 / density) * drift;
    }

    rafId = requestAnimationFrame(scheduler);
  }

  async function startFromUI() {
    ensureAudio();

    // iOS requires resume() from a user gesture; click handler qualifies.
    if (audioContext.state === "suspended") await audioContext.resume();

    rerollHiddenParamsForThisPlay();

    // Ensure any previous tail is cut before restarting
    stopAll(/*internal*/ true);

    isPlaying = true;
    setButtonsPlaying(true);

    sessionStartTime = audioContext.currentTime;
    nextNoteTime = audioContext.currentTime;

    masterGain.gain.setValueAtTime(1, audioContext.currentTime);

    scheduler();
  }

  // internalStop=true means "don’t fight button state if we’re about to restart"
  function stopAll(internalStop = false) {
    if (!audioContext) {
      isPlaying = false;
      if (!internalStop) setButtonsPlaying(false);
      return;
    }
    if (!isPlaying && !internalStop) {
      setButtonsPlaying(false);
      return;
    }

    isPlaying = false;
    if (rafId) cancelAnimationFrame(rafId);

    const now = audioContext.currentTime;
    if (masterGain) {
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    }

    setTimeout(() => {
      activeNodes.forEach(n => { try { n.stop(); } catch (e) {} });
      activeNodes = [];
      if (masterGain) masterGain.gain.setValueAtTime(1, audioContext.currentTime);
    }, 60);

    if (!internalStop) setButtonsPlaying(false);
  }

  // =========================
  // DOM wiring
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    // Popout flag
    if (isPopoutMode()) document.body.classList.add("popout");

    // Launch/Open behavior:
    // - Desktop: open popout
    // - Mobile: switch to one-page player mode
    const launchBtn = document.getElementById("launchPlayer");
    if (launchBtn) {
      launchBtn.addEventListener("click", () => {
        if (isMobileDevice() && !isPopoutMode()) {
          enterMobileOnePageMode();
        } else {
          openPopout();
        }
      });
    }

    // Player wiring (works for popout and mobile-player)
    const setupPlayerUI = () => {
      const saved = loadState();
      applyControls(saved);

      const toneSlider = document.getElementById("tone");
      const hzReadout = document.getElementById("hzReadout");

      if (toneSlider && hzReadout) {
        hzReadout.textContent = toneSlider.value;
        toneSlider.addEventListener("input", () => {
          hzReadout.textContent = toneSlider.value;
          saveState(readControls());
        });
      }

      const sd = document.getElementById("songDuration");
      if (sd) {
        sd.addEventListener("input", () => saveState(readControls()));
        sd.addEventListener("change", () => saveState(readControls()));
      }

      // Initial: stopped state => Stop filled, Play unfilled
      setButtonsPlaying(false);

      document.getElementById("playNow")?.addEventListener("click", async () => {
        saveState(readControls());
        await startFromUI();
      });

      document.getElementById("stop")?.addEventListener("click", () => {
        stopAll(false);
      });
    };

    // If we’re already in popout, setup immediately
    if (isPopoutMode()) setupPlayerUI();

    // If mobile user already has class (e.g., from bfcache), setup too
    if (document.body.classList.contains("mobile-player")) setupPlayerUI();

    // When we enter mobile mode on click, we need to setup UI once
    // (simple approach: observe class change)
    const mo = new MutationObserver(() => {
      if (isPlayerMode()) {
        // Only attach once
        mo.disconnect();
        setupPlayerUI();
      }
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  });
})();