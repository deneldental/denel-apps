/**
 * R9 / T27 — the Team app's AUTHENTICATED surface, and the T2 CSRF fix.
 *
 * Until now nothing had ever driven Team past the login screen, because
 * sign-in needs a real SMS one-time code. With the backend running under
 * `SMS_STUB_FILE`, `helpers.signInAsStaff` completes the real phone -> OTP flow
 * and this spec exercises a real mutation behind the session:
 * `POST /api/staff-portal/attendance/submissions` (the "Request Fix" modal on
 * the Attendance page), which the backend's CSRF middleware protects.
 *
 * ── What the T2 fix was, and what can honestly be proven here ────────────────
 *
 * `team/src/lib/api.ts` used to read the CSRF token ONLY from `document.cookie`.
 * That works same-site, but in the real deployment the frontend (CF Pages) and
 * the backend are different hosts, so `cookieAttributes()` in
 * `backend/src/lib/csrf.ts` takes the `SameSite=None` / no-`domain` branch and
 * `csrf_pwa` is scoped to the BACKEND host — unreadable from the frontend's
 * `document.cookie`, though still attached to `credentials: 'include'` requests
 * by the browser. The fix reads the token from the `/api/csrf` response BODY.
 *
 * A localhost run CANNOT reproduce that: cookies on localhost are port-agnostic
 * and same-host, so `document.cookie` sees `csrf_pwa` either way and the old
 * code would pass too. The third test therefore installs the nearest faithful
 * proxy — it masks `csrf_pwa` out of `document.cookie` while leaving the real
 * cookie in the browser's jar, which is precisely the asymmetry the cross-site
 * deployment creates. Under the pre-T2 client that yields no `X-CSRF-Token`
 * header and a 403; under the fixed client the `/api/csrf` body supplies it.
 *
 * This is a simulation of the cross-site condition, not a real cross-origin
 * run. See the report note in the task summary.
 *
 * Prerequisites — see `helpers.ts`. Skips entirely without a local Postgres.
 */

import { expect, test } from '@playwright/test'
import { API_URL, hasTestDb, hideCsrfCookieFromJs, query, STAFF, signInAsStaff } from './helpers'

const HAS_DB = hasTestDb()

/** The role that actually holds the `pwa` interface scope. */
const ROLE = 'receptionist' as const

/** A past date the fix-request form accepts (`max` is today). */
const FIX_DATE = '2026-01-06'

type SeenRequest = { url: string; method: string; headers: Record<string, string> }

test.describe.configure({ mode: 'serial' })

test.describe('Team — authenticated session and CSRF-protected mutation', () => {
  test.skip(
    !HAS_DB,
    'Needs a local Postgres (DATABASE_URL=postgresql://framada:framada@localhost:5433/framada) ' +
      'plus a backend on :3000 started with SMS_STUB_FILE.'
  )

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
  })

  test('signs in with phone + OTP and lands on the staff dashboard', async ({ page }) => {
    await signInAsStaff(page, ROLE)
    await expect(page).toHaveURL(/\/dashboard/)
    // `/me` resolved: the shell rendered rather than bouncing back to /login.
    await expect(page.locator('body')).not.toContainText(/sign in with your phone number/i)
  })

  test('submits an attendance fix request; the POST carries an X-CSRF-Token from the /api/csrf body', async ({
    page,
  }) => {
    const posts: SeenRequest[] = []
    let csrfBodyToken: string | null = null

    page.on('request', (req) => {
      if (req.method() === 'POST') {
        posts.push({ url: req.url(), method: req.method(), headers: req.headers() })
      }
    })
    page.on('response', async (res) => {
      if (res.url().endsWith('/api/csrf') && res.ok()) {
        try {
          const body = (await res.json()) as { token?: string }
          if (body?.token) csrfBodyToken = body.token
        } catch {
          /* not JSON — ignore */
        }
      }
    })

    await signInAsStaff(page, ROLE)

    // Sign-in itself is CSRF-protected: /api/staff-auth/* is NOT in the
    // BYPASS_PATTERNS list in backend/src/lib/csrf.ts.
    const loginPost = posts.find((p) => p.url.includes('/api/staff-auth/login'))
    expect(loginPost, 'the login POST should have been observed').toBeTruthy()
    expect(loginPost?.headers['x-csrf-token']).toMatch(/^[0-9a-f]{64}$/)

    // ── the mutation ──────────────────────────────────────────────────────
    await page.goto('/attendance')
    // The page header button, not the per-day inline "Request fix" links.
    await page.getByRole('button', { name: 'Request Fix', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.locator('input[type="date"]').fill(FIX_DATE)
    await dialog.locator('input[type="time"]').fill('08:05')
    await dialog.locator('textarea').fill('e2e csrf mutation')

    const submitted = page.waitForResponse(
      (r) =>
        r.url().includes('/api/staff-portal/attendance/submissions') &&
        r.request().method() === 'POST'
    )
    await page.getByRole('button', { name: /^submit$/i }).click()
    const res = await submitted

    expect(res.status(), 'the mutation must not be CSRF-rejected').toBe(200)
    const payload = (await res.json()) as { success?: boolean; data?: { id?: string } }
    expect(payload.success).toBe(true)

    const mutation = posts.find((p) => p.url.includes('/api/staff-portal/attendance/submissions'))
    expect(mutation?.headers['x-csrf-token']).toMatch(/^[0-9a-f]{64}$/)
    // The token the client sent is exactly the one /api/csrf handed back in its
    // JSON body — the property the T2 fix is about.
    if (csrfBodyToken) expect(mutation?.headers['x-csrf-token']).toBe(csrfBodyToken)

    // The write really landed.
    const rows = await query<{ id: string; date: string; time: string; status: string }>(
      `SELECT id, date::text AS date, time::text AS time, status
         FROM staff_attendance_submissions
        WHERE id = $1`,
      [payload.data?.id]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe(FIX_DATE)
    expect(rows[0].status).toBe('pending')
  })

  test('control: the same POST without an X-CSRF-Token header is rejected 403', async ({
    page,
  }) => {
    await signInAsStaff(page, ROLE)
    // `page.request` shares the browser context's cookie jar, so the session
    // cookie rides along — only the CSRF header is missing.
    const res = await page.request.post(`${API_URL}/api/staff-portal/attendance/submissions`, {
      headers: { 'X-App-Id': 'pwa', 'Content-Type': 'application/json' },
      data: { date: FIX_DATE, punchType: 'clock_in', time: '09:00', reason: 'no csrf header' },
    })
    expect(res.status()).toBe(403)
  })

  /**
   * Sensitivity check for the test above. With `csrf_pwa` masked out of
   * `document.cookie` AND the `token` field stripped from the `/api/csrf`
   * response body — the Set-Cookie header is left intact, so the cookie still
   * exists and still rides along — the client has no source left for the
   * header, and the backend rejects. That is what the PRE-T2 client did in the
   * real cross-site deployment: cookie unreadable, body never consulted.
   *
   * It proves the mask is load-bearing (the run above did not pass by accident
   * on some third token source) and that the /api/csrf BODY is what makes the
   * fixed client work.
   */
  test('sensitivity: masked cookie + no body token = the pre-T2 failure mode (403)', async ({
    page,
  }) => {
    await hideCsrfCookieFromJs(page)
    await page.route('**/api/csrf', async (route) => {
      const response = await route.fetch()
      // Keep every header (Set-Cookie included); empty the JSON body only.
      await route.fulfill({ response, json: {} })
    })

    let loginStatus = 0
    page.on('response', (res) => {
      if (res.url().includes('/api/staff-auth/login')) loginStatus = res.status()
    })

    await page.goto('/login')
    const phoneField = page.getByLabel(/phone number/i)
    await phoneField.waitFor({ state: 'visible', timeout: 20_000 })
    await phoneField.fill(STAFF[ROLE].phone)
    await page.getByRole('button', { name: /continue/i }).click()

    // No token available anywhere the client can reach -> CSRF middleware 403s,
    // so sign-in never leaves /login.
    await expect.poll(() => loginStatus, { timeout: 15_000 }).toBe(403)
    await expect(page).toHaveURL(/\/login/)
  })

  test('cross-site simulation: the mutation still works when csrf_pwa is unreadable from document.cookie', async ({
    page,
  }) => {
    await hideCsrfCookieFromJs(page)

    const posts: SeenRequest[] = []
    let csrfBodyToken: string | null = null
    page.on('request', (req) => {
      if (req.method() === 'POST') {
        posts.push({ url: req.url(), method: req.method(), headers: req.headers() })
      }
    })
    page.on('response', async (res) => {
      if (res.url().endsWith('/api/csrf') && res.ok()) {
        try {
          const body = (await res.json()) as { token?: string }
          if (body?.token) csrfBodyToken = body.token
        } catch {
          /* ignore */
        }
      }
    })

    await signInAsStaff(page, ROLE)

    // Prove the simulation is real: the cookie EXISTS in the browser jar (so it
    // still rides along on the request) but JS on the page cannot see it.
    const jar = await page.context().cookies()
    expect(jar.some((c) => c.name === 'csrf_pwa')).toBe(true)
    const visibleToJs = await page.evaluate(() => document.cookie.includes('csrf_pwa'))
    expect(visibleToJs, 'the mask must hide csrf_pwa from document.cookie').toBe(false)

    // Sign-in went through despite the masked cookie — the token can only have
    // come from the /api/csrf response body.
    expect(csrfBodyToken, 'the client must have fetched /api/csrf for a body token').toMatch(
      /^[0-9a-f]{64}$/
    )
    const loginPost = posts.find((p) => p.url.includes('/api/staff-auth/login'))
    expect(loginPost?.headers['x-csrf-token']).toBe(csrfBodyToken)

    // ...and so does a post-auth mutation.
    await page.goto('/attendance')
    await page.getByRole('button', { name: 'Request Fix', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('input[type="date"]').fill(FIX_DATE)
    await dialog.locator('input[type="time"]').fill('08:20')
    await dialog.locator('textarea').fill('e2e csrf cross-site sim')

    const submitted = page.waitForResponse(
      (r) =>
        r.url().includes('/api/staff-portal/attendance/submissions') &&
        r.request().method() === 'POST'
    )
    await page.getByRole('button', { name: /^submit$/i }).click()
    const res = await submitted
    expect(res.status()).toBe(200)

    const mutation = posts.find((p) => p.url.includes('/api/staff-portal/attendance/submissions'))
    expect(mutation?.headers['x-csrf-token']).toBe(csrfBodyToken)
  })
})
