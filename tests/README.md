# Engineering checks

Run the dependency-free regression suite with Node:

```sh
node --test tests/player.test.cjs
```

To additionally compare live and export oscillator schedules with the pre-hardening implementation:

```sh
git show 8a2d9c747ce1e31f48753169240c1393a422d028:player.js > /tmp/open-baseline.js
OPEN_BASELINE=/tmp/open-baseline.js node --test tests/player.test.cjs
```

The tests use a simulated audio clock, Web Audio nodes, and delayed recorder callbacks. They cover rapid playback changes, pending resume cancellation, mobile background stops, two-hour voice-reference bounds, natural tail cleanup, overlapping recording callbacks, export isolation, export failure recovery, and valid zero seeds. Baseline comparisons check oscillator frequency, detuning, and start/stop times separately for live playback and export; they do not require live and exported music to match each other.

Additional regressions cover stalled scheduler callbacks, pauses in the audio clock, finite-session completion after stalls, WAV headers and original PCM quantization, stereo ordering, bounded transferable chunks, and worker failure recovery. No application dependencies are needed for these tests.

The sparse interface, musical probabilities, synthesis envelopes, live ending rules, export ending rules, and manual Stop fade are retained. Completed voices disconnect after a 100 ms filter-settling allowance. Natural completion releases the bus after the last scheduled voice, filter settling, full impulse response, pre-delay, and a 250 ms return-filter margin. Cleanup uses audio time so browser suspension does not truncate a pending tail. New sessions reset drone timing that belonged to earlier sessions.

If the scheduler resumes after an event's start time has passed, it schedules the next event 50 ms ahead of the current audio clock and keeps the current phrase state. It does not generate missed events. Normal scheduling, clock suspension, and the live/export ending rules retain their previous behavior.

WAV encoding runs in a dedicated worker. At most 65,536 frames per channel are copied and transferred in each message; the next chunk is sent only after the worker acknowledges the previous one. The worker builds the final file from Blob parts, preserving the original 16-bit conversion without a full-size WAV ArrayBuffer on the main thread. The full OfflineAudioContext render buffer is still required (about 649 MB for the maximum stereo export), so long exports remain memory intensive.

## Native browser checks

```sh
npm ci
npx playwright install --with-deps chromium --only-shell
npm run test:browser
```

The development-only Playwright dependency exercises a local HTTP server and native Chromium APIs. Browser checks verify slider keyboard focus, sound in a decoded MediaRecorder download, immediate Stop/Play, and a complete 100-second stereo WAV export with playback interaction during worker encoding. Worker acknowledgements are deliberately delayed in the export check to make that interaction reproducible.

GitHub Actions runs the regression suite with the original baseline and the Chromium checks on pushes to `main` and `engineering-hardening`, and on pull requests. Workflow permissions are read-only; it does not publish or deploy the site.

These checks do not audition the music or validate actual browser memory peaks, AirPlay, or iOS hardware behavior. Device checks should cover audible reverb decay and mobile background/restore behavior before release.
