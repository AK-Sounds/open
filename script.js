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

  function createReverb() {
    const duration = 5.0, rate = audioContext.sampleRate, length = rate * duration;
    const impulse = audioContext.createBuffer(2, length, rate);
    for (let j = 0; j < 2; j++) {
      const data = impulse.getChannelData(j);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 1.5);
      }
    }
    reverbNode.buffer = impulse;
  }

  function ensureAudio() {
    if (audioContext) return;
    
    // 1. Initialize Context
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // 2. Create Nodes
    limiter = audioContext.createDynamicsCompressor();
    masterGain = audioContext.createGain();
    reverbNode = audioContext.createConvolver();
    reverbGain = audioContext.createGain();

    // 3. Configure Limiter (Ceiling)
    limiter.threshold.setValueAtTime(-1.0, audioContext.currentTime);
    limiter.knee.setValueAtTime(0, audioContext.currentTime);
    limiter.ratio.setValueAtTime(20, audioContext.currentTime);
    limiter.attack.setValueAtTime(0.003, audioContext.currentTime);
    limiter.release.setValueAtTime(0.1, audioContext.currentTime);

    // 4. Set Initial Volumes
    masterGain.gain.value = 1;
    reverbGain.gain.value = 1.2;

    // 5. CONNECT THE CHAIN
    // Direct path: MasterGain -> Limiter -> Destination
    masterGain.connect(limiter);
    
    // Reverb path: ReverbGain -> Limiter -> Destination
    reverbGain.connect(limiter);
    
    // Final Output
    limiter.connect(audioContext.destination);

    // 6. Generate Reverb impulse
    createReverb();
  }

  function playFmBell(freq, duration, volume, startTime) {
    if (!audioContext) return;

    const numVoices = 2 + Math.floor(Math.random() * 2);
    const voices = [];
    let totalAmp = 0;

    for (let i = 0; i < numVoices; i++) {
      const amp = Math.random();
      voices.push({ modRatio: 1.5 + Math.random() * 2.5, modIndex: 1 + Math.random() * 4, amp });
      totalAmp += amp;
    }

    voices.forEach((voice) => {
      const carrier = audioContext.createOscillator();
      const modulator = audioContext.createOscillator();
      const modGain = audioContext.createGain();
      const ampGain = audioContext.createGain();

      carrier.frequency.value = freq;
      modulator.frequency.value = freq * voice.modRatio;

      modGain.gain.setValueAtTime(freq * voice.modIndex, startTime);
      modGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      ampGain.gain.setValueAtTime(0.0001, startTime);
      ampGain.gain.exponentialRampToValueAtTime((voice.amp / totalAmp) * volume, startTime + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(ampGain);
      
      // Send signal to both the dry master path and the reverb path
      ampGain.connect(reverbNode); // Into Reverb
      reverbNode.connect(reverbGain); // Reverb out to gain
      ampGain.connect(masterGain); // Direct out to master

      modulator.start(startTime);
      carrier.start(startTime);
      modulator.stop(startTime + duration);
      carrier.stop(startTime + duration);
      activeNodes.push(carrier, modulator, ampGain);
    });

    if (activeNodes.length > 200) activeNodes.splice(0, 50);
  }

  function scheduler() {
    if (!isPlaying) return;
    const durationInput = document.getElementById("songDuration").value;
    const currentTime = audioContext.currentTime;

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
      const dur = (1 / density) * 2.5;

      playFmBell(freq, dur, 0.4, nextNoteTime);
      nextNoteTime += (1 / density) * (0.95 + Math.random() * 0.1);
    }
    timerId = requestAnimationFrame(scheduler);
  }

  function stopAll() {
    if (!isPlaying || !audioContext) return;
    isPlaying = false;
    cancelAnimationFrame(timerId);

    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    master
