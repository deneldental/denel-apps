import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E config for the PWA.
 *
 * Local: assumes the backend is already running on :3000 (with SMS_STUB_FILE
 * set so OTPs land in /tmp/pwa-otp-stub.ndjson) and the Vite dev server is
 * started by Playwright on :5175.
 *
 * The SMS stub path is also re-exposed to specs via `process.env.SMS_STUB_FILE`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false, // auth tests share a cookie/session — serialize.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // HTML report in CI so the e2e-smoke-pwa job's upload-artifact step has a
  // trace/screenshot/video to publish on failure (list-only writes nothing).
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5175',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.CI
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:5175',
        reuseExistingServer: true,
        timeout: 120_000,
      },
  projects: [
    // Desktop is the primary surface for the staff PWA on clinic workstations.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Mobile catches viewport-specific issues — touch targets, responsive
    // layout, hamburger nav. PWA usage on phones is the dominant patient
    // pattern. Pixel 7 is a representative mid-range Android viewport.
    { name: 'mobile-android', use: { ...devices['Pixel 7'] } },
    // Add iPhone for the iOS-Safari quirks (different cookie + storage
    // behaviours). Webkit must be installed first via `npx playwright install webkit`.
    { name: 'mobile-ios', use: { ...devices['iPhone 14'] } },
  ],
})
