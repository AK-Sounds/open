(() => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let activeNodes = [];
  let isPlaying = false;
  let scheduledTimer = null;
  
  // Random Walk State (Pitch & Timbre)
  const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  let pitchStep = 2;
  let timbreWalk = 2.0; // Influences the FM modulation index

  // Master Control
  const masterGain = audioContext.createGain();
  masterGain.connect(audioContext.destination);

  // LIGHT SPECTRAL PROCESSING (The "Middle Path")
  // Filters out the high-frequency "hiss" of the reverb for a darker wash
  const reverbNode = audioContext.createConvolver();
  const reverbFilter = audioContext.createBiquadFilter();
  const reverbGain = audioContext.createGain();
  reverbFilter.type = "lowpass";
  reverbFilter.frequency.value = 900; 
  reverbGain.gain.value = 0.5;

  const length = audioContext.sampleRate * 5;
  const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
  }
  reverbNode.buffer = impulse;
  reverbNode.connect(reverbFilter);
  reverbFilter.connect(reverbGain);
  reverbGain.connect(masterGain);

  // Captured from Original: Multi-voice FM synthesis for shimmering character
  function playResonatorFmBell(freq, duration, volume, startTime, brightness) {
    // Two voices per note (Carrier/Modulator pairs) create the 'Resonator' texture
    const voices = [
      { modRatio: 2.0, modIndex: brightness * 1.5, amp: 1.0 },
      { modRatio: 3.5, modIndex: brightness * 0.8, amp: 0.5 }
    ];

    voices.forEach((voice) => {
      const carrier = audioContext.createOscillator();
      const modulator = audioContext.createOscillator();
      const modGain = audioContext.createGain();
      const ampGain = audioContext.createGain();

      carrier.frequency.value = freq;
      modulator.frequency.value = freq * voice.modRatio;

      const deviation = freq * voice.modIndex;
      modGain.gain.setValueAtTime(deviation, startTime);
      modGain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      ampGain.gain.setValueAtTime(0, startTime);
      ampGain.gain.linearRampToValueAtTime(volume * voice.amp * 0.1, startTime + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(ampGain);
      
      ampGain.connect(masterGain); // Dry path
      ampGain.connect(reverbNode); // Wet path through spectral filter

      modulator.start(startTime);
      carrier.start(startTime);
      modulator.stop(startTime + duration);
      carrier.stop(startTime + duration);
      activeNodes.push(carrier, modulator, ampGain);
    });
  }

  function start(limitSeconds = null) {
    if (audioContext.state === 'suspended') audioContext.resume();
    stopCurrentSession();
    isPlaying = true;
    masterGain.gain.value = document.getElementById('volume').value;
    const sessionStart = audioContext.currentTime;

    function loop(time) {
      if (!isPlaying || (limitSeconds && (time - sessionStart) > limitSeconds)) return;
      
      const tone = parseFloat(document.getElementById('tone').value) || 110;
      const density = parseInt(document.getElementById('density').value) || 1;

      // Random Walk logic
      pitchStep = Math.max(0, Math.min(scale.length - 1, pitchStep + (Math.floor(Math.random() * 3) - 1)));
      timbreWalk = Math.max(1.0, Math.min(5.0, timbreWalk + (Math.random() * 0.4 - 0.2)));
      
      const interval = (14 / density) + (Math.random() * 3);
      const freq = tone * Math.pow(2, scale[pitchStep] / 12);

      playResonatorFmBell(freq, 6.0, 1.0, time, timbreWalk);
      setTimeout(() => loop(time + interval), interval * 1000);
    }
    loop(audioContext.currentTime + 0.1);
  }

  // Scheduling & Stop logic
  function schedule() {
    const dur = parseInt(document.getElementById('songDuration').value);
    const freq = parseInt(document.getElementById('frequency').value);
    start(dur); 
    document.getElementById('statusMessage').textContent = `Next play in ${freq}m`;
    clearTimeout(scheduledTimer);
    scheduledTimer = setTimeout(schedule, freq * 60 * 1000);
  }

  function stopCurrentSession() {
    isPlaying = false;
    activeNodes.forEach(n => { try { n.stop(); n.disconnect(); } catch(e) {} });
    activeNodes = [];
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('volume').addEventListener('input', (e) => {
      masterGain.gain.setTargetAtTime(e.target.value, audioContext.currentTime, 0.05);
    });
    document.getElementById('playNow').addEventListener('click', () => {
      clearTimeout(scheduledTimer);
      document.getElementById('statusMessage').textContent = "Active";
      start();
    });
    document.getElementById('schedule').addEventListener('click', schedule);
    document.getElementById('stop').addEventListener('click', () => {
      clearTimeout(scheduledTimer);
      stopCurrentSession();
      document.getElementById('statusMessage').textContent = "";
    });
  });
})();
