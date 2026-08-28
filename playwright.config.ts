import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // software rendering in CI runs the hall at a few frames a second
  timeout: 480_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    video: 'off',
    launchOptions: {
      // the container ships one Chromium; use it rather than downloading another
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-lcd-text'],
    },
  },
  projects: [
    {
      name: 'iphone-portrait',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'ipad-landscape',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1180, height: 820 } },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
