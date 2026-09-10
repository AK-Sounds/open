const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'node tests/serve.cjs',
    url: 'http://127.0.0.1:4173/player.html',
    reuseExistingServer: false,
    timeout: 10000
  }
});
