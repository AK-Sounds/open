/*
 * Open – Generative bell environment
 * * Based on the original Resonator logic. 
 * This script generates low, synthetic FM bell tones that drift 
 * slightly over time. It features spectral filtering and strict 
 * duration management to ensure the environment stays within 
 * the selected time bounds.
 */

(() => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let activeNodes = [];
  let isPlaying = false;
  let scheduledTimer = null;
  
  // Scale and state tracking for the Random Walk
  const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  let currentStep = 2;

  const masterGain = audioContext.createGain();
  masterGain.connect(audioContext.destination);

  // LIGHT SPECTRAL PROCESSING: 900Hz Lowpass on Reverb
  const reverbNode = audioContext.createConvolver();
  const reverbFilter = audioContext.createBiquadFilter();
  const reverbGain = audioContext.createGain();
  
  reverbFilter.type = "lowpass";
  reverbFilter.frequency.value = 900; 
  reverbGain.gain.value = 0.6;

  // Generate Reverb Impulse Response
  const length = audioContext.sampleRate * 5;
  const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.0);
    }
  }
  reverbNode.buffer = impulse;
  reverbNode.connect(reverbFilter);
  reverbFilter.connect(reverbGain);
  reverbGain.connect(masterGain);

  /**
   * Original FM Voice Generation Logic
   */
  function generateRandomFmVoices() {
    const numVoices = 2 + Math.floor(Math.random() * 2); 
    const voices = [];
    let totalAmp = 0;
    for (let i = 0; i < numVoices; i++) {
      const modRatio = 1.5 + Math.random() * 2.5;
      const modIndex = 1 + Math.random() * 4;
      const amp = Math.random();
      voices.push({ modRatio, modIndex, amp });
      totalAmp += amp;
    }
    voices.forEach(v => v.amp = v.amp / totalAmp);
    return voices;
  }

  /**
   * FM Synthesis Bell
   */
  function playFmBell(freq, duration, volume, startTime, voices) {
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

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);

      ampGain.gain.setValueAtTime(0.0001, startTime);
      ampGain.gain.exponentialRampToValueAtTime(volume * voice.amp * 0.15, startTime + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      carrier.connect(ampGain);
      ampGain.connect(masterGain);
      ampGain.connect(reverbNode);

      modulator.start(startTime);
      carrier.start(startTime);
      modulator.stop(startTime + duration);
      carrier.stop(startTime + duration);
      activeNodes.push(carrier, modulator, ampGain);
    });
  }

  /**
   * Main Start Function with Strict Duration Clamping
   */
  function start(limitSeconds = null) {
    if (audioContext.state === 'suspended') audioContext.resume();
    stopCurrentSession();
    isPlaying = true;
    
    // Set master volume from UI
    masterGain.gain.value = document.getElementById('volume').value;
    
    const sessionStart = audioContext.currentTime;
    const sessionVoices = generateRandomFmVoices();
    let accumulatedTime = 0;

    function loop(time) {
      if (!isPlaying) return;
      
      // Stop if we have reached the user-defined duration
      if (limitSeconds && (time - sessionStart) >= limitSeconds) {
          stopCurrentSession();
          document.getElementById('statusMessage').textContent = "";
          return;
      }

      const rootTone = parseFloat(document.getElementById('tone').value) || 110;
      const density = parseInt(document.getElementById('density').value) || 3;

      // Random Walk logic
      const move = Math.floor(Math.random() * 3) - 1; 
      currentStep = Math.max(0, Math.min(scale.length - 1, currentStep + move));
      
      let interval = (10 / density) + (Math.random() * 2);
      
      // STRICT CLAMPING: Ensure the next note doesn't push the session over the time limit
      if (limitSeconds && (time - sessionStart + interval) > limitSeconds) {
          interval = limitSeconds - (time - sessionStart);
      }

      const freq = rootTone * Math.pow(2, scale[currentStep] / 12);

      if (interval > 0.1) {
          playFmBell(freq, 5.0, 1.0, time, sessionVoices);
          setTimeout(() => loop(time + interval), interval * 1000);
      } else {
          // Finish if the final interval is too small
          setTimeout(stopCurrentSession, 5000); 
      }
    }
    
    loop(audioContext.currentTime + 0.1);
  }

  function schedule() {
    const dur = parseInt(document.getElementById('songDuration').value);
    const freq = parseInt(document.getElementById('frequency').value);
    
    start(dur); 
    
    document.getElementById('statusMessage').textContent = "Active";
    
    if (scheduledTimer) clearTimeout(scheduledTimer);
    scheduledTimer = setTimeout(schedule, freq * 60 * 1000);
  }

  function stopCurrentSession() {
    isPlaying = false;
    activeNodes.forEach(n => {
      try {
        n.stop();
        n.disconnect();
      } catch(e) {}
    });
    activeNodes = [];
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Handle live volume updates
    document.getElementById('volume').addEventListener('input', (e) => {
      masterGain.gain.setTargetAtTime(e.target.value, audioContext.currentTime, 0.05);
    });

    document.getElementById('playNow').addEventListener('click', () => {
      if (scheduledTimer) clearTimeout(scheduledTimer);
      document.getElementById('statusMessage').textContent = "Active";
      start(); // Play indefinitely when manual start is clicked
    });

    document.getElementById('schedule').addEventListener('click', schedule);

    document.getElementById('stop').addEventListener('click', () => {
      if (scheduledTimer) clearTimeout(scheduledTimer);
      stopCurrentSession();
      document.getElementById('statusMessage').textContent = "";
    });
  });
})();
