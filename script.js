(() => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  // 1. MASTER OUTPUT STAGE
  // We route everything through a master gain for the smooth global fade-out
  const masterGain = audioContext.createGain();
  masterGain.connect(audioContext.destination);

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

  // 2. REVERB STAGE (Restored to your lush settings)
  const reverbNode = audioContext.createConvolver();
  const reverbGain = audioContext.createGain();
  reverbGain.gain.value = 1.2;

  (function createReverb() {
    const duration = 5.0; 
    const rate = audioContext.sampleRate;
    const length = rate * duration;
    const impulse = audioContext.createBuffer(2, length, rate);
    for (let j = 0; j < 2; j++) {
      const data = impulse.getChannelData(j);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 1.5);
      }
    }
    reverbNode.buffer = impulse;
    reverbNode.connect(reverbGain);
    reverbGain.connect(masterGain); // Connects to Master Gain
  })();

  function playFmBell(freq, duration, volume, startTime) {
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

      const maxDeviation = freq * voice.modIndex;
      modGain.gain.setValueAtTime(maxDeviation, startTime);
      modGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      ampGain.gain.setValueAtTime(0.0001, startTime);
      ampGain.gain.exponentialRampToValueAtTime((voice.amp / totalAmp) * volume, startTime + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(ampGain);
      
      ampGain.connect(reverbNode);
      ampGain.connect(masterGain); // Both dry and wet go to Master Gain

      modulator.start(startTime);
      carrier.start(startTime);
      modulator.stop(startTime + duration + 0.5); 
      carrier.stop(startTime + duration + 0.5);

      activeNodes.push(carrier, modulator, ampGain);
    });
    
    if (activeNodes.length > 200) activeNodes.splice(0, 50);
  }

  function scheduler() {
    if (!isPlaying) return;
    const durationInput = document.getElementById('songDuration').value;
    const currentTime = audioContext.currentTime;
    
    if (durationInput !== 'infinite' && (currentTime - sessionStartTime >= parseFloat(durationInput))) {
      stopAll();
      return;
    }

    while (nextNoteTime < currentTime + scheduleAheadTime) {
      const baseFreq = parseFloat(document.getElementById('tone').value);
      const mood = document.getElementById('mood').value;
      const density = parseFloat(document.getElementById('density').value);
      const scale = scales[mood] || scales.major;
      const freq = baseFreq * Math.pow(2, scale[Math.floor(Math.random() * scale.length)] / 12);

      playFmBell(freq, 2.5, 0.4, nextNoteTime);
      nextNoteTime += (1 / density) * (0.95 + Math.random() * 0.1);
    }
    timerId = requestAnimationFrame(scheduler);
  }

  function stopAll() {
    isPlaying = false;
    cancelAnimationFrame(timerId);
    
    const now = audioContext.currentTime;
    const fadeOutDuration = 0.3; // A slightly longer, more musical fade (300ms)

    // Fade out the MASTER gain node
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + fadeOutDuration);

    // Hard stop of oscillators after they are fully silent
    setTimeout(() => {
      activeNodes.forEach(n => { try { n.stop(); } catch(e) {} });
      activeNodes = [];
      // Reset master gain for next play
      masterGain.gain.setValueAtTime(1.0, audioContext.currentTime + 0.1);
    }, fadeOutDuration * 1000 + 50);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('tone').addEventListener('input', (e) => {
      document.getElementById('hzReadout').textContent = e.target.value;
    });

    document.getElementById('playNow').addEventListener('click', async () => {
      if (audioContext.state === 'suspended') await audioContext.resume();
      
      // Ensure master gain is up before starting
      masterGain.gain.cancelScheduledValues(audioContext.currentTime);
      masterGain.gain.setValueAtTime(1.0, audioContext.currentTime);
      
      stopAll();
      isPlaying = true;
      sessionStartTime = audioContext.currentTime;
      nextNoteTime = audioContext.currentTime;
      scheduler();
    });

    document.getElementById('stop').addEventListener('click', stopAll);
  });
})();
