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

The sparse interface, musical probabilities, synthesis envelopes, live ending rules, export ending rules, and manual Stop fade are retained. Completed voices disconnect after a 100 ms filter-settling allowance. Natural completion releases the bus after the last scheduled voice, filter settling, full impulse response, pre-delay, and a 250 ms return-filter margin. Cleanup uses audio time so browser suspension does not truncate a pending tail. New sessions reset drone timing that belonged to earlier sessions.

These tests do not synthesize or audition audio and do not validate actual browser memory consumption, MediaRecorder encoders, AirPlay, or iOS hardware behavior. Device checks should cover audible reverb decay, downloaded recordings, rapid Stop/Play, and mobile background/restore behavior before release.
