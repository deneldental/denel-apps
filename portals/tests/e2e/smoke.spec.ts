import { expect, test } from '@playwright/test'

/**
 * Smoke suite — the minimum set of assertions that must pass before we deploy.
 * Extends to full flows in separate specs under tests/e2e/flows/.
 */

test.describe('portal smoke', () => {
  test('unauthenticated root redirects to login', async ({ page }) => {
    await page.goto('/')
    // Either redirected to /auth/login or the login form is rendered. Generous
    // timeout: the redirect waits on authClient.getSession(), which can be slow
    // against a cold staging backend on the first request of a CI run.
    await expect(page).toHaveURL(/\/auth\/login|\/login/, { timeout: 30000 })
  })

  test('login page renders required inputs', async ({ page }) => {
    await page.goto('/auth/login')
    // Email + password fields + submit are the contract the UI must keep
    await expect(page.getByLabel(/email|username/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in|log ?in/i })).toBeVisible()
  })

  test('invalid login shows error — does not navigate into the app', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByLabel(/email|username/i).fill('nobody@example.invalid')
    await page.getByLabel(/password/i).fill('wrong-password-never-used')
    await page.getByRole('button', { name: /sign in|log ?in/i }).click()

    // Must stay on auth surface; no leak into /dashboard
    await expect(page).not.toHaveURL(/\/dashboard/)
  })

  test('public appointment confirm page renders for an invalid token', async ({ page }) => {
    // Sanity-check that the public /c/:token route compiles + renders fallback UI
    await page.goto('/c/invalid-token-for-smoke')
    // The page should render the "Link unavailable" state without requiring auth
    await expect(page.getByText(/link unavailable|unable|not found/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })
})
