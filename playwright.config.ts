import { defineConfig, devices } from '@playwright/test'

/**
 * 画面証拠の取得。実機 Safari ではなく、Chromium (WebKit エミュレーションでも
 * ありません) で撮っています。区別は STATUS.md に記載。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'docs/evidence/report.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // この環境に同梱されている Chromium を使う (追加ダウンロードをしない)
        launchOptions: {
          executablePath: process.env['CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium',
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
