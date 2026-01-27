# Open

> *Designed for desktop browsers.*

[*Open*](https://stereo-images.github.io/open/) began with the sound of cathedral bells drifting through an open window. The sound belonged in that room, and I felt its absence when I later moved. That memory became the wellspring for this piece.

Instead of recording bells, I went in the opposite direction: a browser window. No particular scene, no particular place, just a sparse frame for sound to travel through. This music is my way of exploring what can come through that digital window, and what I can build inside it.

The piece makes low, synthetic bell tones. While they’re tuned to a clear set of notes, their internal harmonics are messy, creating tension between a steady melody and an ambiguous bell. Each new session begins from a different seed, and the sounds move slowly, drifting over time so that nothing repeats in a short loop. Notes appear, fade out, and leave space.

The sounds do not ask for your attention. They sit alongside and maybe enhance whatever else is happening: the light in your room, the noise outside, or the work you're doing.

*Open* is meant to run quietly in the background with minimal fuss: no logins and no saved settings. You can change the tone or the duration. Each run is temporary, and when the sound stops, it’s gone.

### "Infinite" Mode and Structure
When set to “Infinite,” the piece becomes a long-form drift using specific harmonic and melodic logic.

* **Circle of Fifths:** Slowly moves by fifths through closely related keys, with intermittent toggles into the relative minor.
* **Contour:** The melody is not random; it uses a constrained random walk. A "gravity" system pulls notes toward a central register, preventing the melody from reaching too high or too low while ensuring no two phrases are identical.
* **Tension:** As structural tension rises (especially around peaks), the bell timbre becomes more fractured—brighter, less stable, and harmonically more ambiguous. Cadences tend to simplify the tone again.

### Technical Architecture
*Open* is built on the standard Web Audio API without external libraries. The engine uses a small FM voice model and convolution reverb to create a sense of physical space.

* **Synthesis:** Notes are generated with FM oscillator pairs. Each note triggers a small cluster (usually 2–3 voices) with slightly different ratios and drift, so the bell is stable in pitch but never perfectly “clean.” In higher-tension moments, the ratios become more irregular for a rougher, more inharmonic sound.
* **Decay:** The timbre fades faster than the volume—by ramping the FM depth down sooner than the amplitude—so notes start brighter and settle toward a simpler tone.
* **Acoustics:**
    * **Impulse Response:** Custom convolution reverb built from a 10-second noise impulse with a shaped decay curve.
    * **Pre-Delay (45ms):** Separates the dry hit from the reverb to suggest distance.
    * **Filter (4200Hz):** Softens the reverb return to keep the top end from getting brittle.
* **Dynamics:** Reverb send is adjusted as density and tension change to avoid buildup. Just before structural peaks, the reverb briefly drops out (“shadow”) and then returns, creating a subtle sense of movement in the room.

### Usage
1. **Launch:** Click "Open" to start the audio.
2. **Tone:** Use the slider to set the fundamental frequency (Safety floor: 100Hz).
3. **Duration:** Select a fixed time (1m, 5m, 10m, 30m) or Infinite.

---
*Est. 2026*

```
