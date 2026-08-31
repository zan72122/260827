import { defineConfig, devices } from '@playwright/test'

// The container ships a pre-installed Chromium (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers).
// We point Playwright at it explicitly instead of downloading a matching build.
const CHROMIUM = '/opt/pw-browsers/chromium'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'artifacts/e2e-report.json' }]],
  outputDir: 'artifacts/e2e-output',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: {
      executablePath: CHROMIUM,
      args: [
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
        '--no-sandbox',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-sync',
        '--no-first-run',
        '--metrics-recording-only',
        '--no-pings',
        '--disable-features=Translate,OptimizationHints,MediaRouter,ChromeWhatsNewUI',
      ],
    },
    trace: 'off',
    video: 'off',
    // 動画は recording.spec.ts でだけ有効にする
  },
  projects: [
    { name: 'phone-portrait', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1 } },
    { name: 'phone-landscape', use: { ...devices['Desktop Chrome'], viewport: { width: 844, height: 390 }, hasTouch: true, deviceScaleFactor: 1 } },
    { name: 'tablet-portrait', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true, deviceScaleFactor: 1 } },
    { name: 'tablet-landscape', use: { ...devices['Desktop Chrome'], viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
