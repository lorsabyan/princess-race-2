import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    // Tests run against the production build (no hot reload, real service worker).
    baseURL: 'http://127.0.0.1:4190',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-angle=metal', '--ignore-gpu-blocklist'] },
    // Stops the breathing button animation so Playwright sees stable targets.
    reducedMotion: 'reduce',
  },
  webServer: {
    command: 'npx vite build --logLevel error && npx vite preview',
    url: 'http://127.0.0.1:4190',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'android-phone', use: { ...devices['Pixel 7'] } },
    { name: 'android-tablet', use: { ...devices['Galaxy Tab S4'] } },
  ],
});
