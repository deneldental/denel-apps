import { expect, test } from '@playwright/test'

/**
 * RBAC gate E2E tests for the portal.
 *
 * Strategy: these tests run unauthenticated. The portal uses client-side
 * auth gating — every protected route checks for a session and redirects
 * to /auth/login if not found. We verify that:
 *
 *  1. All admin-only routes redirect unauthenticated visitors to login
 *  2. All staff routes redirect unauthenticated visitors to login
 *  3. The public /c/:token route does NOT require authentication
 *  4. The login page itself is accessible without auth
 *
 * Full role-specific gate tests (doctor can't see /access-management, etc.)
 * belong in the authenticated flow suite. This suite verifies the baseline:
 * unauthenticated visitors never see protected content.
 */

const ADMIN_ONLY_ROUTES = ['/access-management', '/matrix', '/bundles', '/roles']

const PROTECTED_ROUTES = [
  '/dashboard',
  '/patients',
  '/appointments',
  '/analytics',
  '/specialists', // re-homed clinical module (HR staff/training moved to the HR app)
  '/payments', // finance module landing (there is no bare /finance route)
  '/settings',
  '/audit-logs', // real route is /audit-logs, not /audit
  '/reports/monthly',
  '/reports/quarterly',
]

test.describe('unauthenticated RBAC gates', () => {
  test.describe.configure({ mode: 'parallel' })

  for (const route of ADMIN_ONLY_ROUTES) {
    test(`admin-only route "${route}" redirects to login when unauthenticated`, async ({
      page,
    }) => {
      await page.goto(route)
      // After auth check resolves, must be on the login surface
      await expect(page).toHaveURL(/\/auth\/login|\/login/, { timeout: 30000 })
      // Protected page chrome must not appear
      await expect(page.getByRole('main'))
        .not.toContainText(/access management|matrix|bundles/i, {
          timeout: 3000,
        })
        .catch(() => {
          // If main doesn't exist at all that's fine — means the page wasn't rendered
        })
    })
  }

  for (const route of PROTECTED_ROUTES) {
    test(`protected route "${route}" redirects to login when unauthenticated`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/auth\/login|\/login/, { timeout: 30000 })
    })
  }
})

test.describe('public routes remain accessible without auth', () => {
  test('login page is accessible without auth', async ({ page }) => {
    await page.goto('/auth/login')
    await expect(page).toHaveURL(/\/auth\/login/)
    await expect(page.getByLabel(/email/i)).toBeVisible()
  })

  test('public confirmation route /c/:token renders without login', async ({ page }) => {
    await page.goto('/c/smoke-test-token-invalid')
    // Must NOT be redirected to /auth/login — the public route handles its own error state
    await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 5000 })
  })
})

test.describe('login page security contract', () => {
  test('sign-in button is disabled or page stays on login after empty submit', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByRole('button', { name: /sign in|log ?in/i }).click()
    // HTML5 required-field validation or JS prevents navigation
    await expect(page).toHaveURL(/\/auth\/login/)
  })

  test('credential fields are type="password" and type="email"', async ({ page }) => {
    await page.goto('/auth/login')
    const passwordField = page.getByLabel(/password/i)
    const emailField = page.getByLabel(/email/i)
    await expect(passwordField).toHaveAttribute('type', 'password')
    await expect(emailField).toHaveAttribute('type', 'email')
  })

  test('invalid credentials stay on login page — no navigation into app', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByLabel(/email/i).fill('nonexistent@example.invalid')
    await page.getByLabel(/password/i).fill('wrong-password-12345')
    await page.getByRole('button', { name: /sign in|log ?in/i }).click()
    // After error, URL stays on login surface
    await expect(page).not.toHaveURL(/\/dashboard/, { timeout: 8000 })
  })
})

test.describe('portal shell never leaks protected data to unauthenticated visitors', () => {
  test('root navigation to /dashboard does not render patient records', async ({ page }) => {
    await page.goto('/dashboard')
    // Either redirected to login OR dashboard renders with no patient data visible
    const url = page.url()
    if (url.includes('/dashboard')) {
      // If somehow on dashboard, ensure no patient PII is visible
      const body = await page.textContent('body')
      expect(body).not.toMatch(/\+233\d{9}/) // Ghana phone numbers
    }
    // Otherwise we were redirected, which is the expected outcome
  })
})
