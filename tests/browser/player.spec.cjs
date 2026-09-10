const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.audioProbe = { contexts: [], workers: 0 };
    const OriginalContext = window.AudioContext;
    window.AudioContext = new Proxy(OriginalContext, {
      construct(Target, args) {
        const ctx = new Target(...args);
        window.audioProbe.contexts.push(ctx);
        return ctx;
      }
    });
    const OriginalWorker = window.Worker;
    window.Worker = new Proxy(OriginalWorker, {
      construct(Target, args) {
        window.audioProbe.workers++;
        return new Target(...args);
      }
    });
  });
});

test('the tone slider has visible keyboard focus', async ({ page }) => {
  await page.goto('/player.html');
  await page.locator('#songDuration').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#tone')).toBeFocused();
  await expect(page.locator('#tone')).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('#tone')).toHaveCSS('outline-width', '3px');
});

test('native audio and recording survive immediate Stop → Play', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/player.html');
  await page.locator('#playNow').click();
  await expect(page.locator('#playNow')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    document.getElementById('stop').click();
    document.getElementById('playNow').click();
  });
  await page.waitForFunction(() => audioProbe.contexts[0].currentTime > 0.3);
  expect(await page.evaluate(() => document.getElementById('open-airplay-bridge').srcObject.active)).toBe(true);
  await page.keyboard.press('Shift+R');
  await page.waitForFunction(() => audioProbe.contexts[0].currentTime > 1);
  const downloading = page.waitForEvent('download');
  await page.keyboard.press('Shift+R');
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.webm$/);
  const recorded = await fs.readFile(await download.path());
  expect(recorded.length).toBeGreaterThan(1000);
  // Decode the actual recording to verify there is sound, not just valid metadata.
  const peak = await page.evaluate(async bytes => {
    const decoded = await audioProbe.contexts[0].decodeAudioData(Uint8Array.from(bytes).buffer);
    let max = 0;
    for (const value of decoded.getChannelData(0)) max = Math.max(max, Math.abs(value));
    return max;
  }, Array.from(recorded));
  expect(peak).toBeGreaterThan(0.0001);
  await page.locator('#stop').click();
  await page.waitForFunction(() => document.getElementById('open-airplay-bridge').srcObject === null);
  expect(errors).toEqual([]);
});

test('real WAV rendering and worker encoding allow playback interaction', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Slow worker acknowledgements to exercise interaction during encoding reliably.
  // All DSP, PCM conversion, transfers, and the resulting download remain native.
  const worker = await fs.readFile(path.join(__dirname, '../../wav-worker.js'), 'utf8');
  await page.route('**/wav-worker.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `const send = self.postMessage.bind(self);
      self.postMessage = data => data.type === 'ready' ? setTimeout(() => send(data), 10) : send(data);\n${worker}`
  }));
  await page.goto('/player.html');
  await page.locator('#playNow').click();
  const downloading = page.waitForEvent('download');
  await page.keyboard.press('Shift+E');
  await page.waitForFunction(() => audioProbe.workers === 1);
  await page.evaluate(() => {
    document.getElementById('stop').click();
    document.getElementById('playNow').click();
  });
  await expect(page.locator('#playNow')).toHaveAttribute('aria-pressed', 'true');
  const download = await downloading;
  const wav = await fs.readFile(await download.path());
  expect(download.suggestedFilename()).toMatch(/\.wav$/);
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  expect(wav.readUInt16LE(22)).toBe(2);
  expect(wav.readUInt32LE(24)).toBe(44100);
  expect(wav.readUInt16LE(34)).toBe(16);
  expect(wav.length).toBe(100 * 44100 * 2 * 2 + 44);
  expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
  expect(wav.subarray(44).some(value => value !== 0)).toBe(true);
  expect(await page.evaluate(() => document.getElementById('open-airplay-bridge').srcObject.active)).toBe(true);
  expect(errors).toEqual([]);
});
