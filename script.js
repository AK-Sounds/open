(() => {
  // STABLE KEY: Persists user settings across future updates
  const STATE_KEY = "open_player_settings";

  // =========================
  // UTILITIES & UI
  // =========================
  function isPopoutMode() { return window.location.hash === "#popout"; }
  function isMobileDevice() {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod|Android/i.test(ua) ||
      (window.matchMedia?.("(pointer: coarse)")?.matches && window.matchMedia?.("(max-width: 820px)")?.matches);
  }

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch { return null; }
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
      if (Number.isFinite(n)) toneVal = Math.max(30, Math.min(200, n));
    }

    if (tone) tone.value = String(toneVal);
    if (hzReadout) hzReadout.textContent = String(toneVal);
  }

  function setButtonState(state) {
    const playBtn = document.getElementById("playNow");
    const stopBtn = document.getElementById("stop");
    const toneInput = document.getElementById("tone");

    if (playBtn) playBtn.classList.toggle("filled", state === "playing");
    if (stopBtn) stopBtn.classList.toggle("filled", state !== "playing");
    if (toneInput) toneInput.disabled = (state === "playing");
  }

  // =========================
  // SEEDED RNG (export matches session start)
  // =========================
  function hash32(str) {
    // FNV-1a 32-bit
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeRNG(seedU32) {
    let s = seedU32 >>> 0;
    return {
      next() {
        // Mulberry32
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      getState() { return s >>> 0; },
      setState(x) { s = (x >>> 0); }
    };
  }

  // =========================
  // AUDIO GRAPH (GLOBAL ARCHITECTURE)
  // =========================
  let audioContext = null;
  let masterGain = null;

  let reverbNode = null;
  let reverbGain = null;
  let reverbPreDelay = null; // NEW (pre-delay for clarity)

  let streamDest = null;

  // Playback State
  let isPlaying = false;
  let isEndingNaturally = false;
  let isApproachingEnd = false;
  let timerInterval = null;

  let nextTimeA = 0;
  let patternIdxA = 0;
  let notesSinceModulation = 0;
  let sessionStartTime = 0;

  // Composition State
  let circlePosition = 0;
  let isMinor = false;

  // Density: base + slow macro drift (NEW)
  let runDensity = 0.2;
  let densityBase = 0.2;
  let densityTarget = 0.2;
  let densityLfoRate = 0.0006;
  let densityLfoPhase = 0;

  // Session identity / motif (NEW: memory + evolution)
  let sessionMotif = [];
  let motifPos = 0;
  let phraseStep = 0;
  let pendingLTResolution = false;
  let phraseCount = 0;

  // Harmonic phrasing
  let lastCadenceLandedRoot = true;
  let recentlyModulatedUntil = 0; // time (ctx.currentTime) until which we treat as "recent"

  // Coherent pitch drift (NEW)
  let driftRateHz = 0.004;   // cycles per second
  let driftCents = 6;        // depth
  let driftPhase = 0;

  // RNG per session (NEW)
  let rng = makeRNG(0);
  let sessionSeed = 0;
  let sessionSeedStartState = 0;

  // --- HELPERS ---
  function createImpulseResponse(ctx) {
    const duration = 5.0;
    const decay = 1.5;
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    // Use Math.random here is fine (room IR doesn’t affect “melody identity”)
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return impulse;
  }

  function mapRange(value, inMin, inMax, outMin, outMax) {
    return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
  }

  function circDist(a, b) {
    const d = Math.abs(a - b);
    return Math.min(d, 7 - d);
  }

  function centsToRatio(cents) {
    return Math.pow(2, cents / 1200);
  }

  function initAudio() {
    if (audioContext) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioContext = new Ctx();

    // 1. MASTER BUS (Headroom: 0.3)
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(audioContext.destination);

    // 2. STREAM DEST
    streamDest = audioContext.createMediaStreamDestination();
    masterGain.connect(streamDest);

    // 3. GLOBAL REVERB BUS (NEW: predelay before convolver)
    reverbPreDelay = audioContext.createDelay(0.1);
    reverbPreDelay.delayTime.value = 0.02; // 20ms

    reverbNode = audioContext.createConvolver();
    reverbNode.buffer = createImpulseResponse(audioContext);

    reverbGain = audioContext.createGain();
    reverbGain.gain.value = 0.9;

    reverbPreDelay.connect(reverbNode);
    reverbNode.connect(reverbGain);
    reverbGain.connect(masterGain);

    // 4. WAKE LOCK
    const silent = audioContext.createBuffer(1, 1, audioContext.sampleRate);
    const heartbeat = audioContext.createBufferSource();
    heartbeat.buffer = silent;
    heartbeat.loop = true;
    heartbeat.start();
    heartbeat.connect(audioContext.destination);

    let videoWakeLock = document.querySelector("video");
    if (!videoWakeLock) {
      videoWakeLock = document.createElement("video");
      Object.assign(videoWakeLock.style, {
        position: "fixed", bottom: "0", right: "0",
        width: "1px", height: "1px",
        opacity: "0.01", pointerEvents: "none", zIndex: "-1"
      });
      videoWakeLock.setAttribute("playsinline", "");
      videoWakeLock.setAttribute("muted", "");
      document.body.appendChild(videoWakeLock);
    }
    videoWakeLock.srcObject = streamDest.stream;
    videoWakeLock.play().catch(() => {});

    setupKeyboardShortcuts();
  }

  // =========================
  // NOTE SCHEDULING (NEW: stereo pan + predelay + timbre clamp + coherent drift)
  // =========================
  function scheduleNote(ctx, dryDestination, wetSend, freq, time, duration, volume, noteCtx = {}, perf = {}) {
    const numVoices = 2;

    // Phrase-dependent brightness clamp (NEW)
    // earlier phrase: softer; cadence: a touch brighter but controlled
    const ps = noteCtx.phraseStep ?? 0;
    const isCad = !!noteCtx.isCadence;
    const approaching = !!noteCtx.approachingEnd;

    const brightness =
      approaching ? 0.55 :
      isCad ? 0.65 :
      (ps <= 3 ? 0.35 : ps <= 8 ? 0.45 : 0.55);

    // Wet pre-delay already exists; this is just the send target.
    // Stereo: opposite pans for the two voices; slight jitter but stable.
    const panBase = (perf.panBase != null) ? perf.panBase : (rng.next() * 0.4 - 0.2);

    // Coherent drift (NEW): shared session “tape” wobble
    const tFromStart = time - (noteCtx.sessionStartTime ?? 0);
    const drift = Math.sin((tFromStart * driftRateHz * Math.PI * 2) + driftPhase) * driftCents;
    const driftRatio = centsToRatio(drift);

    // Small random detune becomes tiny (NEW: no ±2Hz jitter)
    const tinyHz = (rng.next() - 0.5) * 0.3;

    // Envelope tuning (NEW: allow “benediction”)
    const attack = perf.attack ?? 0.01;
    const releaseFloor = 0.0001;

    let totalAmp = 0;
    const voices = Array.from({ length: numVoices }, (_, i) => {
      const amp = rng.next();
      totalAmp += amp;

      // Clamp mod index to avoid spikes (NEW)
      const modIndex = (1 + rng.next() * 4) * brightness; // range scaled
      const modRatio = 1.5 + rng.next() * 2.5;

      const pan = Math.max(-0.65, Math.min(0.65, panBase + (i === 0 ? -0.22 : 0.22) + (rng.next() * 0.08 - 0.04)));

      return { amp, modIndex, modRatio, pan };
    });

    voices.forEach((v) => {
      const carrier = ctx.createOscillator();
      const modulator = ctx.createOscillator();
      const modGain = ctx.createGain();
      const ampGain = ctx.createGain();
      const panner = ctx.createStereoPanner();

      carrier.type = "sine";
      modulator.type = "sine";
      panner.pan.setValueAtTime(v.pan, time);

      const f = (freq * driftRatio) + tinyHz;
      carrier.frequency.value = Math.max(10, f);

      modulator.frequency.value = Math.max(1, f * v.modRatio);

      modGain.gain.setValueAtTime(f * v.modIndex, time);
      modGain.gain.exponentialRampToValueAtTime(Math.max(1, f * 0.45), time + duration);

      ampGain.gain.setValueAtTime(releaseFloor, time);
      ampGain.gain.exponentialRampToValueAtTime((v.amp / totalAmp) * volume, time + attack);
      ampGain.gain.exponentialRampToValueAtTime(releaseFloor, time + duration);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);

      carrier.connect(ampGain);
      ampGain.connect(panner);

      // Dry + Wet (NEW: wet send goes to predelay input)
      panner.connect(dryDestination);
      panner.connect(wetSend);

      modulator.start(time);
      carrier.start(time);
      modulator.stop(time + duration);
      carrier.stop(time + duration);
    });
  }

  // =========================
  // HARMONIC & COMPOSITION ENGINE
  // =========================
  function getScaleNote(baseFreq, scaleIndex, circlePos, minorMode, opts = {}) {
    let pos = circlePos % 12;
    if (pos < 0) pos += 12;
    let semitones = (pos * 7) % 12;
    let rootOffset = semitones;
    if (minorMode) rootOffset = (semitones + 9) % 12;

    const majorIntervals = [0, 2, 4, 5, 7, 9, 11];
    const minorIntervals = [0, 2, 3, 5, 7, 8, 10];

    const len = 7;
    const octave = Math.floor(scaleIndex / len);
    const degree = ((scaleIndex % len) + len) % len;

    let intervals = minorMode ? minorIntervals : majorIntervals;

    // Harmonic minor leading tone ONLY right before cadence (NEW)
    if (minorMode && opts.raiseLeadingTone && degree === 6) {
      intervals = minorIntervals.slice();
      intervals[6] = 11;
    }

    const noteValue = rootOffset + intervals[degree] + (octave * 12);
    return baseFreq * Math.pow(2, noteValue / 12);
  }

  function updateHarmonyState(durationInput) {
    // Called only at phrase boundaries / mid-phrase turns (NEW)
    const r = rng.next();
    let totalSeconds = (durationInput === "infinite") ? 99999 : parseFloat(durationInput);
    if (totalSeconds <= 60) return;

    const prevMinor = isMinor;
    const prevCircle = circlePosition;

    if (totalSeconds <= 300) {
      if (r < 0.2) isMinor = !isMinor;
    } else if (totalSeconds <= 1800) {
      if (r < 0.35) isMinor = !isMinor;
      else circlePosition += (rng.next() < 0.7 ? 1 : -1);
    } else if (durationInput === "infinite") {
      if (!isMinor) {
        if (r < 0.6) isMinor = true;
        else circlePosition += (rng.next() < 0.9 ? 1 : -1);
      } else {
        if (r < 0.28) isMinor = false;
        else circlePosition += (rng.next() < 0.9 ? 1 : -1);
      }
    }

    if (prevMinor !== isMinor || prevCircle !== circlePosition) {
      recentlyModulatedUntil = audioContext.currentTime + 20; // “recent” for 20s (NEW)
    }
  }

  function generateSessionMotif(baseFreq) {
    // NEW: tie motif identity to tone + seed feel
    // (still small and stepwise, but less “random cameo”)
    const m = [0];
    let walker = 0;
    for (let i = 0; i < 3; i++) {
      const step = (rng.next() < 0.5 ? 1 : -1) * (rng.next() < 0.25 ? 2 : 1);
      walker += step;

      // gently clamp motif size
      if (walker > 4) walker = 4;
      if (walker < -4) walker = -4;

      m.push(walker);
    }

    // occasional inversion flavor (NEW)
    if (rng.next() < 0.25) {
      for (let i = 1; i < m.length; i++) m[i] = -m[i];
    }
    return m;
  }

  function maybeEvolveMotif() {
    // NEW: every ~8 phrases, nudge one interval by ±1
    if (phraseCount > 0 && (phraseCount % 8 === 0) && sessionMotif.length >= 4) {
      const idx = 1 + Math.floor(rng.next() * (sessionMotif.length - 1));
      const delta = (rng.next() < 0.5 ? -1 : 1);
      sessionMotif[idx] = Math.max(-4, Math.min(4, sessionMotif[idx] + delta));
    }
  }

  // =========================
  // DENSITY ARC (NEW)
  // =========================
  function updateDensityAndMix(now) {
    const t = now - sessionStartTime;

    // slow seasonal drift around base (±15%)
    const lfo = Math.sin((t * densityLfoRate * Math.PI * 2) + densityLfoPhase);
    densityTarget = densityBase * (1 + 0.15 * lfo);

    // smooth approach
    runDensity += (densityTarget - runDensity) * 0.005;

    // keep bounds (original constraints)
    runDensity = Math.max(0.05, Math.min(0.425, runDensity));

    // reverb mix follows density smoothly (NEW)
    const mixLevel = mapRange(runDensity, 0.05, 0.425, 1.08, 0.74);
    reverbGain.gain.setTargetAtTime(mixLevel, now, 0.8);
  }

  // =========================
  // SCHEDULER (LIVE)
  // =========================
  function scheduler() {
    if (!isPlaying) return;

    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const now = audioContext.currentTime;
    const elapsed = now - sessionStartTime;

    updateDensityAndMix(now);

    if (durationInput !== "infinite") {
      const targetDuration = parseFloat(durationInput);
      if (elapsed >= targetDuration) isApproachingEnd = true;
    }

    const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
    let noteDur = (1 / runDensity) * 2.5;

    while (nextTimeA < now + 0.5) {
      let appliedDur = noteDur;
      let clearPendingAfterNote = false;

      // --- ENDING LOGIC (NEW: stronger cadence gravity + final benediction) ---
      if (isApproachingEnd && !isEndingNaturally) {
        // Increase gravity near end: force cadence behavior sooner
        const endForceCadence = true;

        if (patternIdxA % 7 === 0) {
          const freq = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor);
          // a last toll, then benediction
          scheduleNote(
            audioContext,
            masterGain,
            reverbPreDelay,
            freq * 0.5,
            nextTimeA,
            18.0,
            0.45,
            { phraseStep, isCadence: true, approachingEnd: true, sessionStartTime }
          );
          // benediction: very soft, slower attack, longer
          scheduleNote(
            audioContext,
            masterGain,
            reverbPreDelay,
            freq * 0.5,
            nextTimeA + 1.2,
            28.0,
            0.20,
            { phraseStep, isCadence: true, approachingEnd: true, sessionStartTime },
            { attack: 0.06, panBase: 0 } // centered blessing
          );

          beginNaturalEnd();
          return;
        }

        // if not at root yet, keep stepping toward it quickly
        if (endForceCadence) {
          const curOct = Math.floor(patternIdxA / 7) * 7;
          const curDeg = ((patternIdxA - curOct) % 7 + 7) % 7;
          if (curDeg !== 0) {
            let deltaR = 0 - curDeg;
            if (deltaR > 3) deltaR -= 7;
            if (deltaR < -3) deltaR += 7;
            patternIdxA += deltaR;
          }
        }
      }

      // --- PHRASE & CADENCE LOGIC ---
      phraseStep = (phraseStep + 1) % 16;
      if (phraseStep === 0) {
        pendingLTResolution = false;
        phraseCount++;
        maybeEvolveMotif();
      }
      const isCadence = (phraseStep >= 13);

      // --- HARMONY CHANGES ONLY AT 0 or 8 + only if last cadence truly landed (NEW) ---
      if (!isApproachingEnd) {
        const totalSeconds = (durationInput === "infinite") ? 99999 : parseFloat(durationInput);
        const canMove = (totalSeconds > 60) && lastCadenceLandedRoot && (notesSinceModulation > 16);
        const boundary = (phraseStep === 0 || phraseStep === 8);
        const modChance = (durationInput !== "infinite" && totalSeconds > 300) ? 0.35 : 0.10;

        if (boundary && canMove && rng.next() < modChance) {
          updateHarmonyState(durationInput);
          notesSinceModulation = 0;
        }
      }

      // --- SLOWDOWN (kept) ---
      let slowProb = 0.0;
      if (phraseStep === 15) slowProb = 0.85;
      else if (phraseStep === 0) slowProb = 0.25;
      else if (phraseStep === 14) slowProb = 0.35;
      else if (phraseStep === 13) slowProb = 0.20;

      if (rng.next() < slowProb) {
        appliedDur *= (1.20 + rng.next() * 0.20);
      }

      // --- NOTE SELECTION ---
      if (isCadence) {
        // stronger gravity near end (NEW)
        const endBoost = isApproachingEnd ? 0.25 : 0.0;

        const targets = [0, 2, 4];
        const currentOctave = Math.floor(patternIdxA / 7) * 7;
        let deg = patternIdxA - currentOctave;
        deg = ((deg % 7) + 7) % 7;

        let best = targets[0];
        let bestD = circDist(deg, best);
        for (let i = 1; i < targets.length; i++) {
          const t = targets[i];
          const d = circDist(deg, t);
          if (d < bestD || (d === bestD && rng.next() < 0.5)) {
            best = t; bestD = d;
          }
        }

        const landProb = (phraseStep >= 15) ? (0.85 + endBoost) : (0.55 + endBoost * 0.6);
        let targetDeg = best;

        if (rng.next() > landProb) {
          const dir = (rng.next() < 0.65) ? -1 : 1;
          targetDeg = (targetDeg + dir + 7) % 7;
        }

        let delta = targetDeg - deg;
        if (delta > 3) delta -= 7;
        if (delta < -3) delta += 7;

        if (Math.abs(delta) === 3) delta = -3;
        else if (delta === 0 && phraseStep <= 14 && rng.next() < 0.25) delta = -1;

        patternIdxA = currentOctave + deg + delta;

        // Leading tone setup on 14 only (NEW)
        if (phraseStep === 14 && rng.next() < 0.65) {
          const targetDegLT = 6;
          const curOct = Math.floor(patternIdxA / 7) * 7;
          const curDeg = ((patternIdxA - curOct) % 7 + 7) % 7;

          let deltaLT = targetDegLT - curDeg;
          if (deltaLT > 3) deltaLT -= 7;
          if (deltaLT < -3) deltaLT += 7;
          patternIdxA += deltaLT;
          pendingLTResolution = true;
        }

        // Land on root at 15 with higher inevitability (NEW)
        if (phraseStep === 15) {
          if (rng.next() < (pendingLTResolution ? 0.985 : 0.92)) {
            const targetDegRoot = 0;
            const curOct = Math.floor(patternIdxA / 7) * 7;
            const curDeg = ((patternIdxA - curOct) % 7 + 7) % 7;

            let deltaR = targetDegRoot - curDeg;
            if (deltaR > 3) deltaR -= 7;
            if (deltaR < -3) deltaR += 7;
            patternIdxA += deltaR;
          }
          clearPendingAfterNote = true;
        }

      } else {
        // --- NON-CADENCE (NEW: motif feels like memory, not cameo) ---
        // Force motif return at phrase start
        const forceMotif = (phraseStep === 0 || phraseStep === 1);
        const useMotifProb = forceMotif ? 0.85 : 0.55; // was 0.25

        if (sessionMotif.length > 0 && (forceMotif || rng.next() < useMotifProb)) {
          const motifInterval = sessionMotif[motifPos];
          const currentOctave = Math.floor(patternIdxA / 7) * 7;
          patternIdxA = currentOctave + motifInterval;
          motifPos = (motifPos + 1) % sessionMotif.length;

          // Occasionally “answer” the motif with a neighbor tone (NEW)
          if (!forceMotif && rng.next() < 0.20) {
            patternIdxA += (rng.next() < 0.5 ? -1 : 1);
          }
        } else {
          const r = rng.next();
          let shift = 0;
          if (r < 0.45) shift = 1;
          else if (r < 0.90) shift = -1;
          else shift = (rng.next() < 0.5 ? 2 : -2);
          patternIdxA += shift;
        }
      }

      // Bounds Check
      if (patternIdxA > 10) patternIdxA = 10;
      if (patternIdxA < -8) patternIdxA = -8;

      // --- CALCULATE FREQUENCY ---
      const degNow = ((patternIdxA - Math.floor(patternIdxA / 7) * 7) % 7 + 7) % 7;

      // Raise leading tone only at step 14 (and if pending) (NEW)
      const raiseLT =
        isCadence &&
        degNow === 6 &&
        isMinor &&
        (phraseStep === 14 || pendingLTResolution);

      let freq = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor, { raiseLeadingTone: raiseLT });

      // Track whether cadence landed root (NEW)
      if (phraseStep === 15) {
        lastCadenceLandedRoot = (degNow === 0);
      }

      // --- BASS TOLL (NEW: less “perpetual arriving”) ---
      const isRoot = (degNow === 0);
      const atPhraseStart = (phraseStep === 0 || phraseStep === 1);
      const atCadenceHit = (phraseStep === 15); // was (15 || 0)

      // Tie tolling to context: minor or recently modulated (NEW)
      const recentlyMod = (audioContext.currentTime < recentlyModulatedUntil);
      const contextLift = (isMinor || recentlyMod) ? 1.0 : 0.0;

      let tollProb = 0.0;
      if (atPhraseStart) tollProb = 0.0;                 // NEW: never toll on downbeat
      else if (atCadenceHit) tollProb = 0.08 + 0.08*contextLift;
      else tollProb = 0.02 + 0.03*contextLift;

      // One more guard: avoid tolling immediately after a toll
      if (rng.next() < tollProb && isRoot && !atPhraseStart) {
        const dur = atCadenceHit ? 14.0 : 6.0;
        scheduleNote(
          audioContext,
          masterGain,
          reverbPreDelay,
          (freq * 0.5),
          nextTimeA,
          dur,
          0.34,
          { phraseStep, isCadence: false, approachingEnd: isApproachingEnd, sessionStartTime },
          { attack: atCadenceHit ? 0.03 : 0.02 }
        );
      } else {
        scheduleNote(
          audioContext,
          masterGain,
          reverbPreDelay,
          freq,
          nextTimeA,
          appliedDur,
          0.38,
          { phraseStep, isCadence, approachingEnd: isApproachingEnd, sessionStartTime }
        );
      }

      notesSinceModulation++;
      if (clearPendingAfterNote) pendingLTResolution = false;

      nextTimeA += (1 / runDensity) * (0.95 + rng.next() * 0.1);
    }
  }

  // =========================
  // CONTROL LOGIC
  // =========================
  function killImmediate() {
    if (timerInterval) clearInterval(timerInterval);
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
    masterGain.gain.setTargetAtTime(0, now, 0.05);

    setTimeout(killImmediate, 250);
  }

  function beginNaturalEnd() {
    if (isEndingNaturally) return;
    isEndingNaturally = true;
    isPlaying = false;
    if (timerInterval) clearInterval(timerInterval);

    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 20.0);

    setTimeout(() => {
      killImmediate();
      setButtonState("stopped");
    }, 20100);
  }

  async function startFromUI() {
    initAudio();
    if (audioContext.state === "suspended") await audioContext.resume();

    // Reset Master Gain
    masterGain.gain.cancelScheduledValues(audioContext.currentTime);
    masterGain.gain.setValueAtTime(0, audioContext.currentTime);
    masterGain.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.1);

    nextTimeA = audioContext.currentTime;

    patternIdxA = 0;
    circlePosition = 0;
    isMinor = false;
    notesSinceModulation = 0;

    // NEW SESSION STATE
    phraseStep = 15; // ensures first scheduled note increments to 0 (downbeat)
    phraseCount = 0;
    motifPos = 0;
    pendingLTResolution = false;
    isEndingNaturally = false;
    isApproachingEnd = false;

    lastCadenceLandedRoot = true;
    recentlyModulatedUntil = 0;

    // Session seed (NEW): stable-feeling, tied to tone/duration; deterministic within session
    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
    const seedStr = `${Date.now()}|${Math.round(baseFreq * 100)}|${durationInput}`;
    sessionSeed = hash32(seedStr);
    rng = makeRNG(sessionSeed);
    sessionSeedStartState = rng.getState();

    // Density base (NEW: still “rolled”, but now it breathes)
    densityBase = 0.05 + rng.next() * 0.375;
    runDensity = densityBase;
    densityLfoRate = 0.00045 + rng.next() * 0.00055; // very slow
    densityLfoPhase = rng.next() * Math.PI * 2;

    // Coherent drift (NEW)
    driftRateHz = 0.003 + rng.next() * 0.006;
    driftCents = 4 + rng.next() * 5;
    driftPhase = rng.next() * Math.PI * 2;

    // Initial mix
    const mixLevel = mapRange(runDensity, 0.05, 0.425, 1.08, 0.74);
    reverbGain.gain.setValueAtTime(mixLevel, audioContext.currentTime);

    // Motif (NEW: identity + evolution)
    sessionMotif = generateSessionMotif(baseFreq);

    console.log(
      `Session Seed ${sessionSeed} | Density ${runDensity.toFixed(3)} | Drift ${driftCents.toFixed(1)}c @ ${driftRateHz.toFixed(4)}Hz | Motif: [${sessionMotif}]`
    );

    killImmediate();
    isPlaying = true;
    setButtonState("playing");
    sessionStartTime = audioContext.currentTime;

    timerInterval = setInterval(scheduler, 100);
  }

  // =========================
  // EXPORT (Mirrored Logic; deterministic from session start)
  // NOTE: This renders the first ~60s of the current session’s seed.
  // =========================
  async function renderWavExport() {
    if (!audioContext) { alert("Please start playback first."); return; }

    console.log("Rendering Studio Export (deterministic session seed)...");
    const sampleRate = 44100;
    const duration = 75;
    const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const offlineMaster = offlineCtx.createGain();
    offlineMaster.gain.value = 0.3;
    offlineMaster.connect(offlineCtx.destination);

    const offlinePreDelay = offlineCtx.createDelay(0.1);
    offlinePreDelay.delayTime.value = 0.02;

    const offlineReverb = offlineCtx.createConvolver();
    offlineReverb.buffer = createImpulseResponse(offlineCtx);

    const offlineRevGain = offlineCtx.createGain();
    offlineRevGain.gain.value = reverbGain?.gain?.value ?? 0.85;

    offlinePreDelay.connect(offlineReverb);
    offlineReverb.connect(offlineRevGain);
    offlineRevGain.connect(offlineMaster);

    // Clone session RNG from start (NEW)
    const localRng = makeRNG(sessionSeed);
    localRng.setState(sessionSeedStartState);

    // Mirror session parameters at start
    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");

    // Local copies
    let localCircle = 0;
    let localMinor = false;
    let localIdx = 0;
    let localTime = 0;

    let localNotesSinceMod = 0;
    let localPhraseStep = 15;
    let localPendingLT = false;
    let localPhraseCount = 0;
    let localMotifPos = 0;
    let localMotif = sessionMotif.slice();
    let localLastCadenceRoot = true;
    let localRecentlyModUntil = 0;

    // Local density + drift mirrors (deterministic)
    let localDensityBase = densityBase;
    let localRunDensity = localDensityBase;
    let localDensityTarget = localDensityBase;
    const localDensityRate = densityLfoRate;
    const localDensityPhase = densityLfoPhase;

    const localDriftRateHz = driftRateHz;
    const localDriftCents = driftCents;
    const localDriftPhase = driftPhase;

    const totalSeconds = (durationInput === "infinite") ? 99999 : parseFloat(durationInput);

    function localMaybeEvolveMotif() {
      if (localPhraseCount > 0 && (localPhraseCount % 8 === 0) && localMotif.length >= 4) {
        const idx = 1 + Math.floor(localRng.next() * (localMotif.length - 1));
        const delta = (localRng.next() < 0.5 ? -1 : 1);
        localMotif[idx] = Math.max(-4, Math.min(4, localMotif[idx] + delta));
      }
    }

    function localUpdateDensityAndMix(t) {
      const lfo = Math.sin((t * localDensityRate * Math.PI * 2) + localDensityPhase);
      localDensityTarget = localDensityBase * (1 + 0.15 * lfo);
      localRunDensity += (localDensityTarget - localRunDensity) * 0.005;
      localRunDensity = Math.max(0.05, Math.min(0.425, localRunDensity));
      const mix = mapRange(localRunDensity, 0.05, 0.425, 1.08, 0.74);
      offlineRevGain.gain.setTargetAtTime(mix, t, 0.8);
    }

    function localUpdateHarmonyAtBoundary() {
      if (totalSeconds <= 60) return;
      const r = localRng.next();
      const prevMinor = localMinor;
      const prevCircle = localCircle;

      if (totalSeconds <= 300) {
        if (r < 0.2) localMinor = !localMinor;
      } else if (totalSeconds <= 1800) {
        if (r < 0.35) localMinor = !localMinor;
        else localCircle += (localRng.next() < 0.7 ? 1 : -1);
      } else if (durationInput === "infinite") {
        if (!localMinor) {
          if (r < 0.6) localMinor = true;
          else localCircle += (localRng.next() < 0.9 ? 1 : -1);
        } else {
          if (r < 0.28) localMinor = false;
          else localCircle += (localRng.next() < 0.9 ? 1 : -1);
        }
      }

      if (prevMinor !== localMinor || prevCircle !== localCircle) {
        localRecentlyModUntil = localTime + 20;
      }
    }

    // Render ~60s
    while (localTime < 60) {
      localUpdateDensityAndMix(localTime);

      // phrase step
      localPhraseStep = (localPhraseStep + 1) % 16;
      if (localPhraseStep === 0) {
        localPendingLT = false;
        localPhraseCount++;
        localMaybeEvolveMotif();
      }
      const isCadence = (localPhraseStep >= 13);

      // harmony boundary (0 or 8) + landed root + spacing
      const boundary = (localPhraseStep === 0 || localPhraseStep === 8);
      const canMove = (totalSeconds > 60) && localLastCadenceRoot && (localNotesSinceMod > 16);
      const modChance = (durationInput !== "infinite" && totalSeconds > 300) ? 0.35 : 0.10;
      if (boundary && canMove && localRng.next() < modChance) {
        localUpdateHarmonyAtBoundary();
        localNotesSinceMod = 0;
      }

      // slowdown
      let noteDur = (1 / localRunDensity) * 2.5;
      let appliedDur = noteDur;
      let slowProb = 0.0;
      if (localPhraseStep === 15) slowProb = 0.85;
      else if (localPhraseStep === 0) slowProb = 0.25;
      else if (localPhraseStep === 14) slowProb = 0.35;
      else if (localPhraseStep === 13) slowProb = 0.20;

      if (localRng.next() < slowProb) appliedDur *= (1.20 + localRng.next() * 0.20);

      let clearPendingAfter = false;

      // selection
      if (isCadence) {
        const targets = [0, 2, 4];
        const currentOctave = Math.floor(localIdx / 7) * 7;
        let deg = localIdx - currentOctave;
        deg = ((deg % 7) + 7) % 7;

        let best = targets[0];
        let bestD = circDist(deg, best);
        for (let i = 1; i < targets.length; i++) {
          const t = targets[i];
          const d = circDist(deg, t);
          if (d < bestD || (d === bestD && localRng.next() < 0.5)) {
            best = t; bestD = d;
          }
        }

        const landProb = (localPhraseStep >= 15) ? 0.85 : 0.55;
        let targetDeg = best;

        if (localRng.next() > landProb) {
          const dir = (localRng.next() < 0.65) ? -1 : 1;
          targetDeg = (targetDeg + dir + 7) % 7;
        }

        let delta = targetDeg - deg;
        if (delta > 3) delta -= 7;
        if (delta < -3) delta += 7;

        if (Math.abs(delta) === 3) delta = -3;
        else if (delta === 0 && localPhraseStep <= 14 && localRng.next() < 0.25) delta = -1;

        localIdx = currentOctave + deg + delta;

        if (localPhraseStep === 14 && localRng.next() < 0.65) {
          const targetDegLT = 6;
          const curOct = Math.floor(localIdx / 7) * 7;
          const curDeg = ((localIdx - curOct) % 7 + 7) % 7;

          let deltaLT = targetDegLT - curDeg;
          if (deltaLT > 3) deltaLT -= 7;
          if (deltaLT < -3) deltaLT += 7;
          localIdx += deltaLT;
          localPendingLT = true;
        }

        if (localPhraseStep === 15) {
          if (localRng.next() < (localPendingLT ? 0.985 : 0.92)) {
            const targetDegRoot = 0;
            const curOct = Math.floor(localIdx / 7) * 7;
            const curDeg = ((localIdx - curOct) % 7 + 7) % 7;

            let deltaR = targetDegRoot - curDeg;
            if (deltaR > 3) deltaR -= 7;
            if (deltaR < -3) deltaR += 7;
            localIdx += deltaR;
          }
          clearPendingAfter = true;
        }
      } else {
        const forceMotif = (localPhraseStep === 0 || localPhraseStep === 1);
        const useMotifProb = forceMotif ? 0.85 : 0.55;

        if (localMotif.length > 0 && (forceMotif || localRng.next() < useMotifProb)) {
          const motifInterval = localMotif[localMotifPos];
          const currentOctave = Math.floor(localIdx / 7) * 7;
          localIdx = currentOctave + motifInterval;
          localMotifPos = (localMotifPos + 1) % localMotif.length;
          if (!forceMotif && localRng.next() < 0.20) localIdx += (localRng.next() < 0.5 ? -1 : 1);
        } else {
          const r = localRng.next();
          let shift = 0;
          if (r < 0.45) shift = 1;
          else if (r < 0.90) shift = -1;
          else shift = (localRng.next() < 0.5 ? 2 : -2);
          localIdx += shift;
        }
      }

      if (localIdx > 10) localIdx = 10;
      if (localIdx < -8) localIdx = -8;

      const degNow = ((localIdx - Math.floor(localIdx / 7) * 7) % 7 + 7) % 7;
      const raiseLT = isCadence && degNow === 6 && localMinor && (localPhraseStep === 14 || localPendingLT);

      let freq = getScaleNote(baseFreq, localIdx, localCircle, localMinor, { raiseLeadingTone: raiseLT });

      if (localPhraseStep === 15) localLastCadenceRoot = (degNow === 0);

      // tolling
      const isRoot = (degNow === 0);
      const atPhraseStart = (localPhraseStep === 0 || localPhraseStep === 1);
      const atCadenceHit = (localPhraseStep === 15);
      const recentlyMod = (localTime < localRecentlyModUntil);
      const contextLift = (localMinor || recentlyMod) ? 1.0 : 0.0;

      let tollProb = 0.0;
      if (atPhraseStart) tollProb = 0.0;
      else if (atCadenceHit) tollProb = 0.08 + 0.08 * contextLift;
      else tollProb = 0.02 + 0.03 * contextLift;

      if (isRoot && !atPhraseStart && localRng.next() < tollProb) {
        const dur = atCadenceHit ? 14.0 : 6.0;
        // Use the same schedulerNote, but we need deterministic drift params too:
        // We approximate by reusing scheduleNote with global drift vars temporarily.
        const old = { driftRateHz, driftCents, driftPhase, rng };
        rng = localRng;
        driftRateHz = localDriftRateHz;
        driftCents = localDriftCents;
        driftPhase = localDriftPhase;

        scheduleNote(
          offlineCtx,
          offlineMaster,
          offlinePreDelay,
          freq * 0.5,
          localTime,
          dur,
          0.34,
          { phraseStep: localPhraseStep, isCadence: false, approachingEnd: false, sessionStartTime: 0 },
          { attack: atCadenceHit ? 0.03 : 0.02 }
        );

        rng = old.rng;
        driftRateHz = old.driftRateHz;
        driftCents = old.driftCents;
        driftPhase = old.driftPhase;
      } else {
        const old = { driftRateHz, driftCents, driftPhase, rng };
        rng = localRng;
        driftRateHz = localDriftRateHz;
        driftCents = localDriftCents;
        driftPhase = localDriftPhase;

        scheduleNote(
          offlineCtx,
          offlineMaster,
          offlinePreDelay,
          freq,
          localTime,
          appliedDur,
          0.38,
          { phraseStep: localPhraseStep, isCadence, approachingEnd: false, sessionStartTime: 0 }
        );

        rng = old.rng;
        driftRateHz = old.driftRateHz;
        driftCents = old.driftCents;
        driftPhase = old.driftPhase;
      }

      localNotesSinceMod++;
      if (clearPendingAfter) localPendingLT = false;

      localTime += (1 / localRunDensity) * (0.95 + localRng.next() * 0.1);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = bufferToWave(renderedBuffer, duration * sampleRate);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = `open-final-seeded-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 100);
  }

  function bufferToWave(abuffer, len) {
    const numOfChan = abuffer.numberOfChannels;
    const length = len * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    const sampleRate = abuffer.sampleRate;
    let offset = 0, pos = 0;

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

    setUint32(0x46464952);
    setUint32(length - 8);
    setUint32(0x45564157);
    setUint32(0x20746d66);
    setUint32(16);
    setUint16(1);
    setUint16(numOfChan);
    setUint32(sampleRate);
    setUint32(sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2);
    setUint16(16);
    setUint32(0x61746164);
    setUint32(length - pos - 4);

    for (let i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));

    while (pos < length) {
      for (let i = 0; i < numOfChan; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "r") renderWavExport();
    });
  }

  // =========================
  // DOM WIRING
  // =========================
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