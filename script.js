/**
 * Open
 * A generative ambient engine.
 * Influences: Feldman (decay), Eno (utility), Autechre (timbre).
 */

(() => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContext();
  
  // Master compressor to glue the mix and prevent clipping
  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -10;
  compressor.knee.value = 40;
  compressor.ratio.value = 12;
  compressor.connect(audioContext.destination);

  let activeNodes = [];
  let isPlaying = false;
  let nextNoteTime = 0;
  let sessionStartTime = 0;
  let scheduleAheadTime = 0.2; // Seconds to look ahead
  let timerId;

  // Musical data
  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    random: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  // Reverb setup (Procedural Impulse Response)
  const reverbNode = audioContext.createConvolver();
  const reverbGain = audioContext.createGain();
  reverbGain.gain.value = 1.0; // Wet mix

  function createReverb() {
    const duration = 4.0;
    const rate = audioContext.sampleRate;
    const length = rate * duration;
    const impulse = audioContext.createBuffer(2, length, rate);
    
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        // Simple noise decay
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }
    reverbNode.buffer = impulse;
    reverbNode.connect(reverbGain);
    reverbGain.connect(compressor);
  }
  createReverb();

  // FM Synthesis Voice Generation
  function playFmBell(freq, duration, volume, startTime) {
    const numVoices = 2 + Math.floor(Math.random() * 2); 
    const voices = [];
    let totalAmp = 0;

    // Generate unique timbre parameters for this specific note
    for (let i = 0; i < numVoices; i++) {
      const amp = Math.random();
      voices.push({ 
        modRatio: 1.5 + Math.random() * 2.5, // Non-integer ratios for bell tones
        modIndex: 1 + Math.random() * 4,     // Intensity of "metallic" sound
        amp 
      });
      totalAmp += amp;
    }

    voices.forEach((voice) => {
      const carrier = audioContext.createOscillator();
      const modulator = audioContext.createOscillator();
      const modGain = audioContext.createGain();
      const ampGain = audioContext.createGain();

      carrier.frequency.value = freq;
      modulator.frequency.value = freq * voice.modRatio;

      // FM Modulation Envelope
      const maxDeviation = freq * voice.modIndex;
      modGain.gain.setValueAtTime(maxDeviation, startTime);
      modGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      // Amplitude Envelope (Attack -> Decay)
      const normalizedVol = (voice.amp / totalAmp) * volume;
      ampGain.gain.setValueAtTime(0.0001, startTime);
      ampGain.gain.exponentialRampToValueAtTime(normalizedVol, startTime + 0.02);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      // Routing
      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(ampGain);
      
      // Parallel processing: Dry signal + Reverb signal
      ampGain.connect(compressor);       // Dry
      ampGain.connect(reverbNode);       // Wet

      // Lifetime management
      modulator.start(startTime);
      carrier.start(startTime);
      modulator.stop(startTime + duration);
      carrier.stop(startTime + duration);
      
      // Track node for "Stop" button functionality
      activeNodes.push(carrier, modulator, ampGain);
    });
    
    // Garbage Collection: Keep array small to prevent memory leaks in Infinite mode
    if (activeNodes.length > 200) activeNodes.splice(0, 50);
  }

  // The Heartbeat: Looks ahead and schedules notes
  function scheduler() {
    if (!isPlaying) return;
    
    const durationInput = document.getElementById('songDuration').value;
    const currentTime = audioContext.currentTime;
    
    // 1. Check if session time is over
    if (durationInput !== 'infinite') {
      const elapsed = currentTime - sessionStartTime;
      if (elapsed >= parseFloat(durationInput)) {
        stopAll();
        return;
      }
    }

    // 2. Schedule notes into the near future
    while (nextNoteTime < currentTime + scheduleAheadTime) {
      const baseFreq = parseFloat(document.getElementById('tone').value);
      const mood = document.getElementById('mood').value;
      const density = parseFloat(document.getElementById('density').value);
      const scale = scales[mood] || scales.major;

      // Select pitch
      const interval = scale[Math.floor(Math.random() * scale.length)];
      const freq = baseFreq * Math.pow(2, interval / 12);
      
      // Duration is inversely proportional to density (sparse = long decay)
      const dur = (1 / density) * 3.0; 

      playFmBell(freq, dur, 0.3, nextNoteTime);
      
      // Calculate time until next note (with drift)
      const drift = 0.9 + (Math.random() * 0.2);
      nextNoteTime += (1 / density) * drift;
    }
    
    timerId = requestAnimationFrame(scheduler);
  }

  function stopAll() {
    isPlaying = false;
    cancelAnimationFrame(timerId);
    
    // Stop all currently ringing oscillators immediately
    activeNodes.forEach(node => { 
      try { 
        // Ramp down quickly to avoid clicks
        if(node.gain) {
           node.gain.setTargetAtTime(0, audioContext.currentTime, 0.01);
        } else {
           node.stop(); 
        }
      } catch(e) {} 
    });
    activeNodes = [];
  }

  document.addEventListener('DOMContentLoaded', () => {
    const toneSlider = document.getElementById('tone');
    const hzReadout = document.getElementById('hzReadout');
    
    toneSlider.addEventListener('input', () => {
        hzReadout.textContent = toneSlider.value;
    });

    document.getElementById('playNow').addEventListener('click', async () => {
      // AudioContext must be resumed by a user gesture
      if (audioContext.state === 'suspended') await audioContext.resume();
      
      stopAll(); // Reset state
      isPlaying = true;
      sessionStartTime = audioContext.currentTime;
      nextNoteTime = audioContext.currentTime + 0.1; // Start slightly in future
      scheduler();
    });

    document.getElementById('stop').addEventListener('click', stopAll);
  });
})();
