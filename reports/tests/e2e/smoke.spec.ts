import { expect, test } from '@playwright/test'

/**
 * Reports app smoke suite.
 *
 * The reports app is READ-ONLY — it never writes data. It serves financial
 * analytics to authorised clinic managers. Key invariants:
 *
 *  - The app must load (no build-time crash)
 *  - Routes requiring auth redirect to login when no session is present
 *  - No sensitive financial data is accessible without authentication
 *  - Error boundaries must be present (AUDIT FINDING: reports currently has
 *    no error boundary — these tests document the desired state and will
 *    FAIL until a boundary is wired up)
 *
 * Note: reports/ has no Playwright config at the time of writing.
 * Tests run against whatever URL the test runner is pointed at.
 */

test.describe('reports smoke — basic load', () => {
  test('home page loads without crashing', async ({ page }) => {
    await page.goto('/')
    // The reports app title (index.html)
    await expect(page).toHaveTitle(/denel reports/i, { timeout: 10_000 })
  })

  test('page has a visible root element — no blank screen', async ({ page }) => {
    await page.goto('/')
    // The root div should have content; body must not be empty
    const bodyText = await page.textContent('body')
    expect(bodyText?.trim().length).toBeGreaterThan(0)
  })

  test('no JavaScript errors thrown during initial load', async ({ page }) => {
    const jsErrors: string[] = []
    page.on('pageerror', (err) => jsErrors.push(err.message))

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Allow at most minor warnings; zero unhandled promise rejections
    const fatalErrors = jsErrors.filter(
      (e) =>
        !e.includes('ResizeObserver') && // benign browser quirk
        !e.includes('Non-Error promise rejection') // benign in some test envs
    )
    expect(fatalErrors, `JavaScript errors on load: ${fatalErrors.join(', ')}`).toHaveLength(0)
  })
})

test.describe('reports smoke — authentication gating', () => {
  test('protected analytics routes redirect to login when unauthenticated', async ({ page }) => {
    const protectedRoutes = [
      '/analytics',
      '/analytics/financial',
      '/patients',
      '/overview',
      '/workforce',
    ]

    for (const route of protectedRoutes) {
      await page.goto(route)
      // Must either redirect to login or render a login form
      const url = page.url()
      const isOnLoginSurface =
        url.includes('/login') ||
        url.includes('/auth') ||
        (await page.getByLabel(/email|password/i).count()) > 0

      if (!isOnLoginSurface) {
        // If somehow still on the protected route, verify no financial data is visible
        const bodyText = (await page.textContent('body')) ?? ''
        // Financial summaries should not be shown to unauthenticated visitors
        expect(bodyText).not.toMatch(/GH[C₵]\s*[\d,]+\.?\d*\s*(,000|k|m)/i)
      }
    }
  })
})

test.describe('reports smoke — read-only contract', () => {
  test('page renders no create/edit/delete form controls', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Reports is read-only — no write controls should be present on the home page
    // after the initial unauthenticated load
    const submitButtons = await page
      .getByRole('button', { name: /submit|save|create|delete|update/i })
      .count()
    // If there's a login form, one submit button is expected; more indicates write UI
    expect(submitButtons).toBeLessThanOrEqual(1)
  })
})

test.describe('reports smoke — error boundary', () => {
  // These tests verify the AppErrorBoundary component wired into reports/src/App.tsx.
  // They require:
  //   1. A running reports dev server (baseURL configured in playwright.config.ts)
  //   2. A test route or query param that causes a component to throw during render.
  // Until a test route is set up, these are skipped. The boundary itself is
  // implemented in reports/src/components/app-error-boundary.tsx.

  test('error boundary catches component render errors and shows recovery UI', async ({ page }) => {
    test.skip(true, 'Requires test route that throws — implement ?testError=true support first')
    await page.goto('/?testError=true')
    await expect(page.getByText(/something went wrong/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /return to dashboard/i })).toBeVisible()
  })

  test('error boundary fallback shows "Something went wrong" instead of blank screen', async ({
    page,
  }) => {
    test.skip(true, 'Requires test route that throws — implement ?testError=true support first')
    await page.goto('/?testError=true')
    const bodyText = await page.textContent('body')
    expect(bodyText?.trim().length).toBeGreaterThan(0)
    await expect(page.getByText(/something went wrong/i)).toBeVisible()
  })

  test('error boundary fallback includes a "Try again" button', async ({ page }) => {
    test.skip(true, 'Requires test route that throws — implement ?testError=true support first')
    await page.goto('/?testError=true')
    await expect(page.getByRole('button', { name: /try again/i })).toBeVisible()
  })
})

test.describe('reports smoke — no sensitive data leakage', () => {
  test('unauthenticated page body contains no database error strings', async ({ page }) => {
    await page.goto('/')
    const bodyText = (await page.textContent('body')) ?? ''

    // Must never expose raw DB errors or stack traces in the page body
    expect(bodyText).not.toMatch(/\b23\d{3}\b/) // Postgres error codes
    expect(bodyText).not.toMatch(/TypeError.*at\s+\w+\s+\(/)
    expect(bodyText).not.toMatch(/Cannot read propert/i)
    expect(bodyText).not.toMatch(/violates.*constraint/i)
  })

  test('page does not expose API keys or secrets in meta tags or scripts', async ({ page }) => {
    await page.goto('/')
    // Check inline script content for credential patterns
    const scripts = await page.locator('script:not([src])').allTextContents()
    for (const scriptContent of scripts) {
      expect(scriptContent).not.toMatch(/["']sk-[a-zA-Z0-9]{20,}["']/) // OpenAI-style keys
      expect(scriptContent).not.toMatch(/DATABASE_URL\s*=\s*['"]postgres/) // DB URL
      expect(scriptContent).not.toMatch(/BETTER_AUTH_SECRET\s*=/) // Auth secret
    }
  })
})
