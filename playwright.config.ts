import { defineConfig } from '@playwright/test';

/**
 * この環境で利用できるブラウザは Chromium のみ（/opt/pw-browsers に WebKit が無い）。
 * したがって WebKit / 実機 iPhone での検証は **行えていない**。
 * ここで確認できるのは「Chromium のモバイルエミュレーションでの挙動」だけである。
 */
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 15 * 60 * 1000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    launchOptions: {
      executablePath: CHROME,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-gpu-sandbox',
      ],
    },
  },
  projects: [
    {
      name: 'iphone14-size-chromium',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
