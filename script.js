(() => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let activeNodes = [];

  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    random: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  const reverbNode = audioContext.createConvolver();
  const reverbGain = audioContext.createGain();
  reverbGain.gain.value = 0.5; 

  function createReverb() {
    const duration = 5.0;
    const rate = audioContext.sampleRate;
    const length = rate * duration;
    const impulse = audioContext.createBuffer(2, length, rate);
    for (let j = 0; j < 2; j++) {
      const data = impulse.getChannelData(j);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
      }
    }
    reverbNode.buffer = impulse;
    reverbNode.connect(reverbGain);
    reverbGain.connect(audioContext.destination);
  }
  createReverb();

  /** * THE RANDOM WALK:
   * Generates unique FM parameters for the duration of the current song.
   **/
  function generateFmTimbre() {
    return {
      // Random ratio between 1.4 and 3.5 creates different bell profiles
      modRatio: 1.4 + Math.random() * 2.1,
      // Random depth of modulation
      modIndex: 1.0 + Math.random() * 4.0
    };
  }

  function playFmBell(freq, duration, volume, startTime, timbre) {
    const carrier = audioContext.createOscillator();
    const modulator = audioContext.createOscillator();
    const modGain = audioContext.createGain();
    const ampGain = audioContext.createGain();

    carrier.frequency.value = freq;
    modulator.frequency.value = freq * timbre.modRatio;

    // The index "walks" back to 0 over the duration of the note
    modGain.gain.setValueAtTime(freq * timbre.modIndex, startTime);
    modGain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

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
      const noteDur = (1 / density) * (0.8 + Math.random() * 0.4);
      
      melody.push({ freq, start: currentTime, dur: noteDur });
      
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

    toneSlider.addEventListener('input', () => { hzReadout.textContent = toneSlider.value; });

    playBtn.addEventListener('click', async () => {
      if (audioContext.state === 'suspended') { await audioContext.resume(); }
      stopAll();
      
      const params = {
        length: document.getElementById('songDuration').value,
        tone: toneSlider.value,
        mood: document.getElementById('mood').value,
        density: document.getElementById('density').value
      };

      // Each "Play" click generates a new specific timbre walk
      const currentTimbre = generateFmTimbre();
      const melody = generateMelody(params);
      const now = audioContext.currentTime;
      
      melody.forEach(note => {
        playFmBell(note.freq, note.dur, 0.4, now + note.start, currentTimbre);
      });

      document.getElementById('statusMessage').textContent = "playing...";
    });

    stopBtn.addEventListener('click', stopAll);
  });
})();
