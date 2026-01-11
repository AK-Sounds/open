(() => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let activeNodes = [];

  // Musical Scales
  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    random: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  // Global Reverb for a cavernous, "Triadic Memories" feel
  const reverbNode = audioContext.createConvolver();
  const reverbGain = audioContext.createGain();
  reverbGain.gain.value = 0.5; 

  function createReverb() {
    const duration = 5.0; // Long decay
    const rate = audioContext.sampleRate;
    const length = rate * duration;
    const impulse = audioContext.createBuffer(2, length, rate);
    for (let j = 0; j < 2; j++) {
      const data = impulse.getChannelData(j);
      for (let i = 0; i < length; i++) {
        // Exponentially decaying noise
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
      }
    }
    reverbNode.buffer = impulse;
    reverbNode.connect(reverbGain);
    reverbGain.connect(audioContext.destination);
  }
  createReverb();

  // Low-frequency Bell Synth (FM Synthesis)
  function playFmBell(freq, duration, volume, startTime) {
    const carrier = audioContext.createOscillator();
    const modulator = audioContext.createOscillator();
    const modGain = audioContext.createGain();
    const ampGain = audioContext.createGain();

    carrier.frequency.value = freq;
    modulator.frequency.value = freq * 1.618; // Inharmonic golden ratio for bells

    // Modulation Index: controls the "metallic" timbre
    modGain.gain.setValueAtTime(freq * 1.5, startTime);
    modGain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

    // Amplitude Envelope: soft bell hit
    ampGain.gain.setValueAtTime(0.0001, startTime);
    ampGain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
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

  // Generative Logic: Feldman-esque Sparse Pacing
  function generateMelody(params) {
    const length = parseFloat(params.length);
    const baseFreq = parseFloat(params.tone);
    const density = parseFloat(params.density);
    const scale = scales[params.mood] || scales.major;
    
    const totalNotes = Math.max(1, Math.floor(length * density));
    const melody = [];
    let currentTime = 0;

    for (let i = 0; i < totalNotes; i++) {
      const interval = scale[Math.floor(Math.random() * scale.length)];
      const freq = baseFreq * Math.pow(2, interval / 12);
      
      // Note Duration: notes linger and breathe
      const noteDur = (1 / density) * (0.8 + Math.random() * 0.4);
      
      melody.push({ freq, start: currentTime, dur: noteDur });
      
      // Simple complexity: Rhythms stick close to a steady, slow pulse
      const drift = 0.95 + (Math.random() * 0.1);
      currentTime += (1 / density) * drift;
    }
    return melody;
  }

  function stopAll() {
    activeNodes.forEach(node => { try { node.stop(); } catch(e) {} });
    activeNodes = [];
    document.getElementById('statusMessage').textContent = "ready.";
  }

  document.addEventListener('DOMContentLoaded', () => {
    const toneSlider = document.getElementById('tone');
    const hzReadout = document.getElementById('hzReadout');
    const playBtn = document.getElementById('playNow');
    const stopBtn = document.getElementById('stop');

    // Frequency Readout Update
    toneSlider.addEventListener('input', () => {
      hzReadout.textContent = toneSlider.value;
    });

    playBtn.addEventListener('click', async () => {
      // Autoplay Fix: Resume context on interaction
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      stopAll();
      
      const params = {
        length: document.getElementById('songDuration').value,
        tone: toneSlider.value,
        mood: document.getElementById('mood').value,
        density: document.getElementById('density').value
      };

      const now = audioContext.currentTime;
      const melody = generateMelody(params);
      
      melody.forEach(note => {
        // Lower frequencies (30-200Hz) require higher volume to be felt
        playFmBell(note.freq, note.dur, 0.4, now + note.start);
      });

      document.getElementById('statusMessage').textContent = "playing...";
    });

    stopBtn.addEventListener('click', stopAll);
  });
})();
