(() => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let activeNodes = [];
  let isPlaying = false;
  let scheduledTimer = null;
  
  // Random Walk State
  const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  let currentStep = 2;

  // Master Volume Control
  const masterGain = audioContext.createGain();
  masterGain.connect(audioContext.destination);

  // Reverb & Spectral Smearing
  const reverbNode = audioContext.createConvolver();
  const reverbFilter = audioContext.createBiquadFilter();
  const reverbGain = audioContext.createGain();
  reverbFilter.type = "lowpass";
  reverbFilter.frequency.value = 900; 
  reverbGain.gain.value = 0.4;

  // Generate Impulse
  const length = audioContext.sampleRate * 4;
  const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
  }
  reverbNode.buffer = impulse;
  reverbNode.connect(reverbFilter);
  reverbFilter.connect(reverbGain);
  reverbGain.connect(masterGain); // Connect to master gain instead of destination

  function playBrightFmBell(freq, startTime) {
    const carrier = audioContext.createOscillator();
    const modulator = audioContext.createOscillator();
    const modGain = audioContext.createGain();
    const ampGain = audioContext.createGain();
    const duration = 5.0;

    carrier.frequency.value = freq;
    modulator.frequency.value = freq * 3.501; 
    modGain.gain.setValueAtTime(freq * 6.0, startTime); 
    modGain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

    ampGain.gain.setValueAtTime(0, startTime);
    ampGain.gain.linearRampToValueAtTime(0.12, startTime + 0.02); 
    ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(ampGain);
    
    ampGain.connect(masterGain); // Connect dry to master
    ampGain.connect(reverbNode); // Connect wet to master via reverb chain

    modulator.start(startTime);
    carrier.start(startTime);
    modulator.stop(startTime + duration);
    carrier.stop(startTime + duration);
    activeNodes.push(carrier, modulator, ampGain);
  }

  function start(limitSeconds = null) {
    if (audioContext.state === 'suspended') audioContext.resume();
    stopCurrentSession();
    isPlaying = true;
    
    // Set initial volume
    masterGain.gain.value = document.getElementById('volume').value;
    
    const sessionStart = audioContext.currentTime;

    function loop(time) {
      if (!isPlaying || (limitSeconds && (time - sessionStart) > limitSeconds)) return;
      
      const tone = parseFloat(document.getElementById('tone').value) || 110;
      const density = parseInt(document.getElementById('density').value) || 1;

      const move = Math.floor(Math.random() * 3) - 1; 
      currentStep = Math.max(0, Math.min(scale.length - 1, currentStep + move));
      
      const interval = (12 / density) + (Math.random() * 4);
      const freq = tone * Math.pow(2, scale[currentStep] / 12);

      playBrightFmBell(freq, time);
      setTimeout(() => loop(time + interval), interval * 1000);
    }
    loop(audioContext.currentTime + 0.1);
  }

  function schedule() {
    const duration = parseInt(document.getElementById('songDuration').value);
    const frequency = parseInt(document.getElementById('frequency').value);
    start(duration); 
    document.getElementById('statusMessage').textContent = `Scheduled: Next play in ${frequency}m`;
    clearTimeout(scheduledTimer);
    scheduledTimer = setTimeout(schedule, frequency * 60 * 1000);
  }

  function stopCurrentSession() {
    isPlaying = false;
    activeNodes.forEach(n => { try { n.stop(); n.disconnect(); } catch(e) {} });
    activeNodes = [];
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Volume slider listener
    document.getElementById('volume').addEventListener('input', (e) => {
      masterGain.gain.setTargetAtTime(e.target.value, audioContext.currentTime, 0.05);
    });

    document.getElementById('playNow').addEventListener('click', () => {
      clearTimeout(scheduledTimer);
      document.getElementById('statusMessage').textContent = "Open and active";
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
