import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E config for the reports app.
 *
 * Local: run against the dev server on :3000.
 * CI (post-deploy): set PLAYWRIGHT_BASE_URL to the deployed reports URL.
 * Reports smoke is frontend-only (no backend dependency) so it is safe to run
 * against a static deploy.
 */
export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
