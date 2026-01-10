(() => {
  // We initialize the context, but it might start in a "suspended" state
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let activeNodes = [];

  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    random: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  // Reverb setup
  const reverbNode = audioContext.createConvolver();
  const reverbGain = audioContext.createGain();
  reverbGain.gain.value = 0.4; 

  function createReverb() {
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
    reverbNode.buffer = impulse;
    reverbNode.connect(reverbGain);
    reverbGain.connect(audioContext.destination);
  }
  createReverb();

  function playFmBell(freq, duration, volume, startTime) {
    const carrier = audioContext.createOscillator();
    const modulator = audioContext.createOscillator();
    const modGain = audioContext.createGain();
    const ampGain = audioContext.createGain();

    carrier.frequency.value = freq;
    modulator.frequency.value = freq * 1.5; // Harmonic ratio
    modGain.gain.setValueAtTime(freq * 2, startTime);
    modGain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

    ampGain.gain.setValueAtTime(0.0001, startTime);
    ampGain.gain.exponentialRampToValueAtTime(volume, startTime + 0.01);
    ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(ampGain);
    ampGain.connect(audioContext.destination);
    ampGain.connect(reverbNode);

    modulator.start(startTime);
    carrier.start(startTime);
    modulator.stop(startTime + duration);
    carrier.stop(startTime + duration);

    activeNodes.push(carrier, modulator, ampGain);
  }

  function generateMelody(params) {
    const length = parseFloat(params.length);
    const baseFreq = parseFloat(params.tone); // Now correctly 110
    const density = parseFloat(params.density); // Now handles 0.1 properly
    const scale = scales[params.mood] || scales.major;
    
    const totalNotes = Math.max(1, Math.floor(length * density));
    const melody = [];
    let currentTime = 0;

    for (let i = 0; i < totalNotes; i++) {
      const interval = scale[Math.floor(Math.random() * scale.length)];
      const freq = baseFreq * Math.pow(2, interval / 12);
      const dur = (1 / density) * (0.5 + Math.random());
      melody.push({ freq, start: currentTime, dur });
      currentTime += (1 / density);
    }
    return melody;
  }

  function stopAll() {
    activeNodes.forEach(node => { try { node.stop(); } catch(e) {} });
    activeNodes = [];
    document.getElementById('statusMessage').textContent = "Stopped.";
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('playNow').addEventListener('click', async () => {
      // CRITICAL: Resume AudioContext on user click
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      stopAll();
      
      const params = {
        length: document.getElementById('songDuration').value,
        tone: document.getElementById('tone').value,
        mood: document.getElementById('mood').value,
        density: document.getElementById('density').value
      };

      const now = audioContext.currentTime;
      const melody = generateMelody(params);
      
      melody.forEach(note => {
        playFmBell(note.freq, note.dur, 0.3, now + note.start);
      });

      document.getElementById('statusMessage').textContent = "Playing...";
    });

    document.getElementById('stop').addEventListener('click', stopAll);
  });
})();
