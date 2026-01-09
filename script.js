(() => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let activeNodes = [];
  
  const reverbNode = audioContext.createConvolver();
  const reverbGain = audioContext.createGain();
  reverbGain.gain.value = 0.6;

  const length = audioContext.sampleRate * 4;
  const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
  }
  reverbNode.buffer = impulse;
  reverbNode.connect(reverbGain);
  reverbGain.connect(audioContext.destination);

  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9]
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function playFmBell(freq, duration, volume, startTime) {
    const carrier = audioContext.createOscillator();
    const modulator = audioContext.createOscillator();
    const modGain = audioContext.createGain();
    const ampGain = audioContext.createGain();

    carrier.frequency.value = freq;
    modulator.frequency.value = freq * 1.5;
    modGain.gain.setValueAtTime(freq * 2, startTime);
    modGain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

    ampGain.gain.setValueAtTime(0, startTime);
    ampGain.gain.linearRampToValueAtTime(volume, startTime + 0.1);
    ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(ampGain);
    ampGain.connect(reverbNode);
    ampGain.connect(audioContext.destination);

    carrier.start(startTime);
    modulator.start(startTime);
    modulator.stop(startTime + duration);
    carrier.stop(startTime + duration);

    const delay = Math.max(0, (startTime - audioContext.currentTime) * 1000);
    setTimeout(() => {
      const layer = document.getElementById('ambient-layer');
      if (layer) layer.style.background = 'radial-gradient(circle, rgba(88,166,255,0.08) 0%, #0a0c10 70%)';
      const title = document.querySelector('header h1');
      if (title) title.style.opacity = '0.4';
      setTimeout(() => {
        if (layer) layer.style.background = 'transparent';
        if (title) title.style.opacity = '0.6';
      }, 450);
    }, delay);

    activeNodes.push(carrier, modulator, ampGain);
  }

  function start() {
    if (audioContext.state === 'suspended') audioContext.resume();
    stop();
    const tone = clamp(parseFloat(document.getElementById('tone').value) || 110, 30, 200);
    const density = clamp(parseInt(document.getElementById('density').value, 10) || 1, 1, 5);
    const mood = document.getElementById('mood').value;
    const scale = scales[mood] || scales.pentatonic;

    document.getElementById('statusMessage').textContent = 'Atmosphere Active';

    function scheduleNext(time) {
      const interval = (6 / density) + Math.random() * 4;
      const noteIndex = Math.floor(Math.random() * scale.length);
      const freq = tone * Math.pow(2, scale[noteIndex] / 12);

      playFmBell(freq, 4, 0.3, time);
      const nextTime = time + interval;
      const timeout = Math.max(0, (nextTime - audioContext.currentTime) * 1000);
      const timer = setTimeout(() => scheduleNext(nextTime), timeout);
      activeNodes.push({ stop: () => clearTimeout(timer) });
    }
    scheduleNext(audioContext.currentTime + 0.1);
  }

  function stop() {
    activeNodes.forEach(n => { try { n.stop && n.stop(); n.disconnect && n.disconnect(); } catch(e){} });
    activeNodes = [];
    const status = document.getElementById('statusMessage');
    if (status) status.textContent = 'Idle Space';
  }

  document.getElementById('playNow').addEventListener('click', start);
  document.getElementById('stop').addEventListener('click', stop);
})();