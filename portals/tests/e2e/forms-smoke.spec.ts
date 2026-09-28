import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/**
 * Authenticated form-smoke suite for the portal.
 *
 * Runs against the live stack (backend :3000 + portal :5173 + Neon dev DB).
 * Requires the seeded test logins (`pnpm seed:test-logins`, default password
 * TestPass1234). Override creds via E2E_EMAIL / E2E_PASSWORD / E2E_API_URL.
 *
 * What it guards (the bugs found on 2026-06-04):
 *   1. The finance/payments page must not crash when an outstanding invoice has
 *      a null patient (clinic-ledger Array.map null deref).
 *   2. Transactional write paths must succeed on the Neon dev DB — the neon-http
 *      driver has no transaction support, so a regression there 500s every
 *      `db.transaction()` write (payments, expenses, journal, invoices, …).
 *      Add-Expense exercises a full transactional write end-to-end.
 *   3. Core module pages render without tripping an error boundary.
 */

// Default to 127.0.0.1 (not "localhost") so we don't resolve to ::1 and hit
// ECONNREFUSED when the backend binds IPv4. Override via E2E_API_URL.
const API = process.env.E2E_API_URL || 'http://127.0.0.1:3000'
const EMAIL = process.env.E2E_EMAIL || 'admin@test.framada.app'
const PASSWORD = process.env.E2E_PASSWORD || 'TestPass1234'

/** Log in via the backend so the session cookie lands in the browser context. */
async function login(page: Page): Promise<void> {
  const res = await page.request.post(`${API}/api/auth/sign-in/email`, {
    data: { email: EMAIL, password: PASSWORD },
    headers: { 'X-App-Id': 'portal', 'Content-Type': 'application/json' },
  })
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy()
}

/** True when the in-app error boundary ("…section crashed") is on screen. */
async function hasErrorBoundary(page: Page): Promise<boolean> {
  const text =
    (await page
      .locator('main')
      .first()
      .innerText()
      .catch(() => '')) || ''
  return /section crashed|Something went wrong|Cannot read properties|is not a function/i.test(text)
}

/** Probe the backend health endpoint; false on any connection error. */
async function backendReachable(request: APIRequestContext): Promise<boolean> {
  return request
    .get(`${API}/api/health`, { timeout: 3000 })
    .then((r) => r.ok())
    .catch(() => false)
}

test.describe('portal authenticated form smoke', () => {
  // This is a LIVE-STACK suite — it needs the backend (+ seeded Neon dev DB) on
  // ${API}. CI's portal e2e job runs only the frontend, so skip cleanly there
  // instead of failing with ECONNREFUSED. Runs in full when the stack is up.
  test.beforeEach(async ({ page, request }) => {
    test.skip(
      !(await backendReachable(request)),
      `backend not reachable at ${API} — skipping live-stack form smoke`
    )
    await login(page)
  })

  // ── 1. Core module pages must render without crashing ────────────────────
  const ROUTES = [
    '/dashboard',
    '/patients',
    '/appointments',
    '/payments',
    '/expenses',
    '/services',
    '/products',
    '/inventory',
    '/tax-calculations',
    '/labs',
    '/insurance',
    '/xrays',
    '/clinical/cases',
    '/hr',
  ]

  for (const route of ROUTES) {
    test(`renders ${route} without an error boundary`, async ({ page }) => {
      await page.goto(route)
      // Give lazy chunks + first data fetch time to resolve.
      await page.waitForLoadState('networkidle').catch(() => {})
      expect(await hasErrorBoundary(page), `error boundary on ${route}`).toBe(false)
    })
  }

  // ── 2. Regression: payments page + the null-patient outstanding row ───────
  test('payments outstanding-invoices tab renders even with a null-patient invoice', async ({
    page,
  }) => {
    await page.goto('/payments')
    await expect(page.getByRole('heading', { name: /Payments & Ledger/i })).toBeVisible()
    await page.getByRole('tab', { name: /Outstanding Invoices/i }).click()
    // The fix renders an "Unknown patient" fallback instead of throwing.
    expect(await hasErrorBoundary(page)).toBe(false)
  })

  // ── 3. Regression: a full transactional write (Add Expense) succeeds ──────
  test('Add Expense submits successfully (transactional write path)', async ({ page }) => {
    await page.goto('/expenses')
    await page.getByRole('button', { name: 'Add Expense' }).click()

    const dialog = page.getByRole('dialog', { name: /Add Expense/i })
    await expect(dialog).toBeVisible()

    // Category (Radix select)
    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Other' }).click()

    await dialog.getByRole('spinbutton', { name: /Amount/i }).fill('42')
    await dialog.getByRole('textbox', { name: /Paid To/i }).fill('E2E Vendor')

    // Payment method (second Radix select). Date defaults to today.
    await dialog.getByRole('combobox').nth(1).click()
    await page.getByRole('option', { name: 'Cash' }).click()

    const post = page.waitForResponse(
      (r) => r.url().includes('/api/expenses') && r.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: 'Create Expense' }).click()
    const res = await post
    expect(res.status(), 'expense POST should be 2xx').toBeLessThan(300)
  })
})
