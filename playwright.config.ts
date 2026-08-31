import { defineConfig, devices } from '@playwright/test';

/**
 * The four screens the game has to work on, in both orientations.
 * A local Chromium build can be pointed at with CHROMIUM_PATH.
 */
const SIZES = [
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'tablet-portrait', width: 820, height: 1180 },
  { name: 'tablet-landscape', width: 1180, height: 820 },
];

const launchOptions = {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    hasTouch: true,
    isMobile: false,
    launchOptions,
  },
  projects: SIZES.map((s) => ({
    name: s.name,
    use: { ...devices['Desktop Chrome'], viewport: { width: s.width, height: s.height }, launchOptions },
  })),
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
