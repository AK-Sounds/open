// Dependency-free lifecycle tests with a controllable audio clock and async recorder.
// These exercise scheduling/state, not browser DSP or device audio routing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(source = fs.readFileSync(path.join(__dirname, '../player.js'), 'utf8')) {
  let wall = 0, nextTimer = 0;
  const timers = new Map(), contexts = [], recordings = [], downloads = [], blobs = [];
  const elements = new Map();
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  class Context {
    constructor() {
      this.currentTime = 0; this.sampleRate = 44100; this.state = 'running';
      this.nodes = []; this.destination = {}; contexts.push(this);
    }
    node(kind) {
      const n = { kind, gain: param(), frequency: param(), detune: param(), Q: param(),
        delayTime: param(), connections: [], disconnected: false,
        connect(to) { this.connections.push(to); }, disconnect() { this.disconnected = true; },
        start(t) { this.startTime = t; }, stop(t) { this.stopTime = t; } };
      this.nodes.push(n); return n;
    }
    createGain() { return this.node('gain'); }
    createOscillator() { return this.node('oscillator'); }
    createBiquadFilter() { return this.node('filter'); }
    createConvolver() { return this.node('convolver'); }
    createDelay() { return this.node('delay'); }
    createMediaStreamDestination() {
      const n = this.node('stream');
      const track = { stopped: false, stop() { this.stopped = true; } };
      n.stream = { getTracks: () => [track] }; return n;
    }
    createBuffer(channels, length, rate) {
      return { duration: length / rate, sampleRate: rate,
        getChannelData: () => new Float32Array(length) };
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  class OfflineContext extends Context {
    startRendering() {
      return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    }
  }
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(stream, options) {
      this.stream = stream; this.mimeType = options?.mimeType || 'audio/mp4';
      this.state = 'inactive'; recordings.push(this);
    }
    start() { if (this.failStart || Recorder.failStart) throw Error('start'); this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    finish(text) { this.ondataavailable({ data: new Blob([text], { type: this.mimeType }) }); this.onstop(); }
  }
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: id === 'tone' ? '110' : 'infinite',
      classList: { toggle() {} }, style: {}, setAttribute() {}, addEventListener() {},
      play: () => Promise.resolve(), pause() {}, click() { downloads.push(this.download); } });
    return elements.get(id);
  }
  const addTimer = (fn, ms, repeat) => {
    const id = ++nextTimer; timers.set(id, { fn, due: wall + ms / 1000, repeat: repeat ? ms / 1000 : 0 }); return id;
  };
  const sandbox = { console, Blob, Float32Array, Uint32Array, ArrayBuffer, DataView,
    navigator: { userAgent: 'desktop', maxTouchPoints: 0 },
    crypto: { getRandomValues(a) { a[0] = 12345; return a; } },
    AudioContext: Context, OfflineAudioContext: OfflineContext, MediaRecorder: Recorder,
    localStorage: { getItem() { return null; }, setItem() {} },
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    document: { getElementById: element, createElement: () => element(Symbol()),
      addEventListener() {}, body: { appendChild() {}, removeChild() {} }, hidden: false },
    addEventListener() {},
    setTimeout: (fn, ms) => addTimer(fn, ms, false), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => addTimer(fn, ms, true), clearInterval: id => timers.delete(id) };
  sandbox.window = sandbox;
  // Test-only access inside the IIFE, without exposing internals in production.
  const expose = `globalThis.api = { startFromUI, stopAllManual, toggleRecording,
    renderWavExport, beginNaturalEnd, scheduleNote, scheduleDroneChord, handleVisibilityChange,
    state: () => ({ audioContext, bus, isPlaying, isEndingNaturally, isRecording,
      nodes: activeNodes.size, snapshot: sessionSnapshot }),
    setup: () => { ensureAudioContext(); buildMixBus(); },
    suspend: () => { audioContext.state = 'suspended'; },
    resumeWith: (fn) => { audioContext.resume = fn; }
  };`;
  vm.runInNewContext(source.replace(/\}\)\(\);\s*\/\/ --- END OF SCRIPT ---/, expose + '\n})();'), sandbox);
  function advance(seconds, audio = true) {
    const target = wall + seconds;
    while (wall < target - 1e-9) {
      const step = Math.min(0.05, target - wall); wall += step;
      if (audio) for (const ctx of contexts) if (ctx.state === 'running') ctx.currentTime += step;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= wall + 1e-9 && timers.has(id)) {
          if (timer.repeat) timer.due = wall + timer.repeat; else timers.delete(id);
          timer.fn();
        }
      }
    }
  }
  return { api: sandbox.api, sandbox, advance, contexts, recordings, downloads, blobs, elements, Recorder };
}

test('rapid Stop → Play cannot tear down the new session', async () => {
  const h = harness(); await h.api.startFromUI();
  const old = h.api.state().bus;
  h.api.stopAllManual(false); h.advance(0.02);
  await h.api.startFromUI(); const current = h.api.state().bus;
  assert.notEqual(current, old); h.advance(0.3);
  assert.equal(h.api.state().bus, current);
  assert.equal(current.masterGain.disconnected, false);
  assert.equal(old.streamDest.stream.getTracks()[0].stopped, true);
});

test('Stop cancels a Play waiting for audio resume', async () => {
  const h = harness(); h.api.setup(); h.api.suspend();
  let resume; h.api.resumeWith(() => new Promise(r => { resume = r; }));
  const pending = h.api.startFromUI(); h.api.stopAllManual(true);
  h.contexts[0].state = 'running'; resume(); await pending;
  assert.equal(h.api.state().isPlaying, false); assert.equal(h.api.state().bus, null);
});

test('an older rejected resume cannot stop a newer successful Play', async () => {
  const h = harness(); h.api.setup(); h.api.suspend();
  let reject; h.api.resumeWith(() => new Promise((r, j) => { reject = j; }));
  const pending = h.api.startFromUI(); h.contexts[0].state = 'running';
  await h.api.startFromUI(); const current = h.api.state().bus;
  reject(Error('old resume')); await pending;
  assert.equal(h.api.state().bus, current); assert.equal(h.api.state().isPlaying, true);
});

test('two simulated hours keep voice references bounded and preserve the shared reverb', async () => {
  const h = harness(); await h.api.startFromUI(); const bus = h.api.state().bus;
  let peak = 0;
  for (let minute = 0; minute < 120; minute++) {
    h.advance(60); peak = Math.max(peak, h.api.state().nodes);
    assert.ok(h.api.state().nodes < 150);
  }
  assert.ok(peak > 0); assert.equal(bus.reverbNode.disconnected, false);
  assert.ok(h.contexts[0].nodes.filter(n => n.kind === 'oscillator' && n.disconnected).length > 1000);
  h.api.stopAllManual(true); assert.equal(h.api.state().nodes, 0);
});

test('natural cleanup waits for the longest voice, reverb, and audio clock; recording finishes', () => {
  const h = harness(); h.api.setup(); const { audioContext: ctx, bus } = h.api.state();
  h.api.scheduleNote(ctx, bus.masterGain, bus.reverbSend, 110, 0, 60, 0.4);
  h.api.scheduleDroneChord(ctx, bus.masterGain, bus.reverbSend, 110, 0, 32, 0.4, 'maj');
  h.api.toggleRecording(); h.api.beginNaturalEnd();
  h.advance(61); assert.equal(h.api.state().nodes, 0);
  assert.equal(h.api.state().bus, bus); assert.equal(h.recordings[0].state, 'recording');
  h.advance(120, false); assert.equal(h.api.state().bus, bus);
  h.advance(11); assert.equal(h.api.state().bus, null);
  assert.equal(h.recordings[0].state, 'inactive');
  assert.equal(bus.reverbNode.disconnected, true);
  assert.equal(bus.streamDest.stream.getTracks()[0].stopped, true);
});

test('natural-ending cleanup cannot kill a replacement session', async () => {
  const h = harness(); await h.api.startFromUI(); h.api.beginNaturalEnd();
  await h.api.startFromUI(); const current = h.api.state().bus;
  h.advance(100); assert.equal(h.api.state().bus, current);
});

test('recordings own their chunks and MIME type across delayed stop callbacks', async () => {
  const h = harness(); await h.api.startFromUI();
  h.api.toggleRecording(); const first = h.recordings[0]; first.mimeType = 'audio/mp4';
  h.api.toggleRecording(); h.api.toggleRecording(); const second = h.recordings[1];
  first.finish('first'); assert.equal(h.api.state().isRecording, true);
  h.api.toggleRecording(); second.finish('second');
  assert.equal(await h.blobs[0].text(), 'first'); assert.equal(await h.blobs[1].text(), 'second');
  assert.match(h.downloads[0], /\.m4a$/); assert.match(h.downloads[1], /\.webm$/);
});

test('recording start failure does not leave a false recording state', async () => {
  const h = harness(); await h.api.startFromUI(); h.Recorder.failStart = true;
  h.api.toggleRecording(); assert.equal(h.api.state().isRecording, false);
});

test('mobile backgrounding cancels pending audio resume and closes the context', async () => {
  const h = harness(); h.api.setup(); h.api.suspend();
  h.sandbox.navigator.userAgent = 'iPhone';
  let resume; h.api.resumeWith(() => new Promise(r => { resume = r; }));
  const pending = h.api.startFromUI(); h.api.handleVisibilityChange({ type: 'pagehide' });
  resume(); await pending;
  assert.equal(h.api.state().audioContext, null);
  assert.equal(h.api.state().bus, null); assert.equal(h.api.state().isPlaying, false);
});

test('zero is a valid export seed', async () => {
  const h = harness(); h.sandbox.crypto.getRandomValues = a => { a[0] = 0; return a; };
  await h.api.startFromUI(); h.elements.get('songDuration').value = '60';
  const pending = h.api.renderWavExport(); assert.equal(h.contexts.length, 2);
  h.contexts[1].reject(Error('render')); await pending;
});

function notes(ctx) {
  return ctx.nodes.filter(n => n.kind === 'oscillator').map(n => [n.frequency.value, n.detune.value, n.startTime, n.stopTime]);
}

test('export leaves live notes unchanged, rejects concurrent exports, and recovers from failure', async () => {
  const a = harness(), b = harness(); await a.api.startFromUI(); await b.api.startFromUI();
  a.elements.get('songDuration').value = '60';
  b.elements.get('songDuration').value = '60';
  const pending = a.api.renderWavExport(); await a.api.renderWavExport();
  assert.equal(a.contexts.length, 2);
  a.advance(30); b.advance(30); assert.deepEqual(notes(a.contexts[0]), notes(b.contexts[0]));
  a.contexts[1].reject(Error('render')); await pending;
  const retry = a.api.renderWavExport(); assert.equal(a.contexts.length, 3);
  a.contexts[2].reject(Error('render')); await retry;
});

test('first-run live synthesis and timing match the original source for ten minutes', async (t) => {
  const original = process.env.OPEN_BASELINE;
  if (!original) { t.skip('Set OPEN_BASELINE to an original player.js for comparison'); return; }
  const a = harness(), b = harness(fs.readFileSync(original, 'utf8'));
  await a.api.startFromUI(); await b.api.startFromUI(); a.advance(600); b.advance(600);
  // Ignore stopped/disconnected bookkeeping; oscillator parameters and times must match.
  assert.deepEqual(notes(a.contexts[0]), notes(b.contexts[0]));
});

test('export retains its independent original sequence and ending', async (t) => {
  const original = process.env.OPEN_BASELINE;
  if (!original) { t.skip('Set OPEN_BASELINE to an original player.js for comparison'); return; }
  const a = harness(), b = harness(fs.readFileSync(original, 'utf8'));
  await a.api.startFromUI(); await b.api.startFromUI();
  a.elements.get('songDuration').value = '600'; b.elements.get('songDuration').value = '600';
  const pendingA = a.api.renderWavExport(), pendingB = b.api.renderWavExport();
  const caughtB = pendingB.catch(() => {});
  assert.deepEqual(notes(a.contexts[1]), notes(b.contexts[1]));
  a.contexts[1].reject(Error('render')); b.contexts[1].reject(Error('render'));
  await pendingA; await caughtB;
});
