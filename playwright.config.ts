import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 900_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    hasTouch: true,
    isMobile: false,
    launchOptions: {
      // WebGL has to come from somewhere in a headless runner
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    // The full round runs on one phone and one tablet; the framing checks run
    // on all four representative frames. Device scale is pinned to 1 so a
    // software renderer can keep up.
    {
      name: 'iphone-portrait',
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 },
    },
    {
      name: 'ipad-landscape',
      use: { viewport: { width: 1080, height: 810 }, deviceScaleFactor: 1 },
    },
    {
      name: 'iphone-landscape',
      testMatch: /framing\.spec\.ts/,
      use: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 },
    },
    {
      name: 'ipad-portrait',
      testMatch: /framing\.spec\.ts/,
      use: { viewport: { width: 810, height: 1080 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
