(() => {
  let audioContext = null;
  let masterGain = null;
  let limiter = null;
  let reverbNode = null;
  let reverbGain = null;
  let activeNodes = [];
  let isPlaying = false;
  let nextNoteTime = 0;
  let sessionStartTime = 0;
  let scheduleAheadTime = 0.2;
  let timerId;

  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    random: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  function createReverbBuffer() {
    const duration = 4.0;
    const rate = audioContext.sampleRate;
    const length = rate * duration;
    const impulse = audioContext.createBuffer(2, length, rate);
    for (let j = 0; j < 2; j++) {
      const data = impulse.getChannelData(j);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }
    return impulse;
  }

  function ensureAudio() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // 1. Create Limiter (The "Safety Ceiling")
    limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-1.0, audioContext.currentTime);
    limiter.knee.setValueAtTime(0, audioContext.currentTime);
    limiter.ratio.setValueAtTime(20, audioContext.currentTime);
    limiter.attack.setValueAtTime(0.003, audioContext.currentTime);
    limiter.release.setValueAtTime(0.2, audioContext.currentTime);

    // 2. Create Master Gain (The "Click Preventer")
    masterGain = audioContext.createGain();
    masterGain.gain.value = 1;

    // 3. Create Reverb Path
    reverbNode = audioContext.createConvolver();
    reverbNode.buffer = createReverbBuffer();
    reverbGain = audioContext.createGain();
    reverbGain.gain.value = 0.4; // Controlled reverb volume

    // 4. THE WIRING (SIGNAL FLOW)
    // Bells -> MasterGain -> Limiter -> Destination
    // Bells -> ReverbNode -> ReverbGain -> Limiter -> Destination
    
    masterGain.connect(limiter);
    reverbGain.connect(limiter);
    limiter.connect(audioContext.destination);
  }

  function playFmBell(freq, duration, volume, startTime) {
    const carrier = audioContext.createOscillator();
    const modulator = audioContext.createOscillator();
    const modGain = audioContext.createGain();
    const ampGain = audioContext.createGain();

    // FM Synthesis Settings
    const ratio = 1.5 + Math.random() * 2.0;
    const index = 2 + Math.random() * 5;

    carrier.frequency.setValueAtTime(freq, startTime);
    modulator.frequency.setValueAtTime(freq * ratio, startTime);
    modGain.gain.setValueAtTime(freq * index, startTime);
    modGain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

    // Envelope
    ampGain.gain.setValueAtTime(0.0001, startTime);
    ampGain.gain.exponentialRampToValueAtTime(volume, startTime + 0.01);
    ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(ampGain);

    // ROUTING
    ampGain.connect(masterGain); // Direct path
    ampGain.connect(reverbNode); // Into reverb
    reverbNode.connect(reverbGain); // Reverb out (wired once in ensureAudio)

    modulator.start(startTime);
    carrier.start(startTime);
    modulator.stop(startTime + duration);
    carrier.stop(startTime + duration);
    
    activeNodes.push(carrier, modulator, ampGain);
    if (activeNodes.length > 200) activeNodes.splice(0, 50);
  }

  function scheduler() {
    if (!isPlaying) return;
    const currentTime = audioContext.currentTime;
    const durationInput = document.getElementById("songDuration").value;

    if (durationInput !== "infinite" && (currentTime - sessionStartTime) >= parseFloat(durationInput)) {
      stopAll();
      return;
    }

    while (nextNoteTime < currentTime + scheduleAheadTime) {
      const mood = document.getElementById("mood").value;
      const scale = scales[mood] || scales.major;
      const tone = parseFloat(document.getElementById("tone").value);
      const density = parseFloat(document.getElementById("density").value);
      
      const interval = scale[Math.floor(Math.random() * scale.length)];
      const freq = tone * Math.pow(2, interval / 12);
      const dur = (1 / density) * 2.0;

      playFmBell(freq, dur, 0.3, nextNoteTime);
      nextNoteTime += (1 / density) * (0.95 + Math.random() * 0.1);
    }
    timerId = requestAnimationFrame(scheduler);
  }

  function stopAll() {
    if (!isPlaying || !audioContext) return;
    isPlaying = false;
    cancelAnimationFrame(timerId);

    // Prevent click by ramping down master volume
    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    setTimeout(() => {
      activeNodes.forEach(n => { try { n.stop(); } catch(e) {} });
      activeNodes = [];
      if (masterGain) masterGain.gain.setValueAtTime(1, audioContext.currentTime);
    }, 60);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const toneSlider = document.getElementById("tone");
    toneSlider.addEventListener("input", () => {
      document.getElementById("hzReadout").textContent = toneSlider.value;
    });

    document.getElementById("playNow").addEventListener("click", async () => {
      ensureAudio();
      if (audioContext.state === "suspended") await audioContext.resume();
      
      // Snappy restart
      isPlaying = false;
      cancelAnimationFrame(timerId);
      activeNodes.forEach(n => { try { n.stop(); } catch(e) {} });
      activeNodes = [];
      
      masterGain.gain.cancelScheduledValues(audioContext.currentTime);
      masterGain.gain.setValueAtTime(1, audioContext.currentTime);

      isPlaying = true;
      sessionStartTime = audioContext.currentTime;
      nextNoteTime = audioContext.currentTime;
      scheduler();
    });

    document.getElementById("stop").addEventListener("click", stopAll);
  });
})();
