(() => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let scheduledTimer = null;
  let activeNodes = [];

  // ... (Keep preferences and feedback functions as they are) ...

  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    random: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  /** Requirement 4: Updated to handle lower density float values **/
  function generateMelody(params) {
    const length = parseFloat(params.length) || 30;
    const baseFreq = parseFloat(params.tone) || 110; // Requirement 3: Default 110
    
    let moodName = params.mood;
    if (moodName === 'random') {
      moodName = chooseMoodFromPreferences();
    }
    const scale = scales[moodName] || scales.major;
    const complexity = params.melody;
    
    // Using parseFloat to ensure decimal density (e.g. 0.1) works
    const density = parseFloat(params.density) || 1; 

    const complexityFactor = { simple: 0.5, medium: 1, complex: 1.5 };
    const notesPerSecond = density * (complexityFactor[complexity] || 1);
    const totalNotes = Math.max(2, Math.floor(length * notesPerSecond));

    const durations = [];
    let remainingTime = length;
    const baseDur = 1 / notesPerSecond;
    
    for (let i = 0; i < totalNotes - 1; i++) {
      let factor = 1;
      if (complexity === 'simple') factor = 0.8 + Math.random() * 0.4;
      else if (complexity === 'medium') factor = 0.5 + Math.random() * 1.5;
      else factor = 0.25 + Math.random() * 2.0;
      
      let dur = baseDur * factor;
      if (remainingTime - dur < baseDur * 0.5) dur = Math.max(0.1, remainingTime / 2);
      durations.push(dur);
      remainingTime -= dur;
    }
    durations.push(Math.max(0.2, remainingTime));

    const melody = [];
    let currentTime = 0;
    durations.forEach((dur) => {
      const interval = scale[Math.floor(Math.random() * scale.length)];
      const freq = baseFreq * Math.pow(2, interval / 12);
      melody.push({ freq, start: currentTime, dur });
      currentTime += dur;
    });
    return melody;
  }

  // ... (Keep playModalBell and playFmBell functions as they are) ...

  function getParams() {
    return {
      length: document.getElementById('songDuration').value,
      tone: document.getElementById('tone').value,
      mood: document.getElementById('mood').value,
      melody: document.getElementById('melody').value,
      density: document.getElementById('density').value, // Reads the new 0.1 - 10 range
      volume: 0.5 // Default volume if range removed from UI
    };
  }

  // (Keep the event listeners for playNow and stop)
})();
