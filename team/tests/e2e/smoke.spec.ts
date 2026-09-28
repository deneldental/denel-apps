import { expect, test } from '@playwright/test'

/**
 * Team app smoke suite — the pre-deploy baseline health check.
 *
 * CI-wired: `.github/workflows/deploy.yml` → job `e2e-smoke-pwa` runs
 * `playwright test smoke.spec.ts --project=chromium` against the DEPLOYED
 * staging build (`STAGING_PWA_URL`), on pushes to `staging` only.
 *
 * ── Why this file was rewritten (D6) ────────────────────────────────────────
 * The old version was written against `pwa/`, before the split described in
 * `project-docs/pwa-split-patient-team-build-plan.md`:
 *
 *   - sign-in was an "Account ID" + "Password" form. Team is **passwordless**
 *     now — phone number → 6-digit SMS code (`@denel/ui/blocks` PhoneForm /
 *     OtpForm, driven by `team/src/components/auth/login-form.tsx`).
 *   - `/patient/*` moved to the separate `patient/` app.
 *   - `/trainer/*` moved to the `hr/` app.
 *
 * Every assertion below matches the routes actually declared in
 * `team/src/App.tsx`.
 *
 * ── Deliberately unauthenticated ────────────────────────────────────────────
 * The CI job has no DATABASE_URL and the staging backend does not run with
 * `SMS_STUB_FILE`, so no OTP can be read and no session can be established.
 * That is by design: smoke covers the surfaces reachable before sign-in.
 * The authenticated surface is exercised by `authenticated-csrf.spec.ts`,
 * which skips itself without a local Postgres + SMS-stub backend.
 *
 * Concerns covered (per the CI job comment):
 *   1. routing        — protected routes bounce to /login; public ones do not
 *   2. security       — login-page contract, no password affordances,
 *                       no account enumeration, removed trees unreachable
 *   3. manifest       — the PWA manifest is served and is the STAFF manifest
 *   4. data leakage   — no PII, secrets or raw error strings pre-auth
 */

/** Deployed lazy chunks + a cold staging backend are slower than localhost. */
const NAV_TIMEOUT = 20_000

// ─── 1. App shell ────────────────────────────────────────────────────────────

test.describe('Team smoke — app shell', () => {
  test('app loads without unhandled JavaScript errors', async ({ page }) => {
    const jsErrors: string[] = []
    page.on('pageerror', (err) => jsErrors.push(err.message))

    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect(page.getByLabel(/phone number/i)).toBeVisible({ timeout: NAV_TIMEOUT })
    // Give late/async errors a window to surface, but never hang the test.
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

    const fatalErrors = jsErrors.filter(
      (e) =>
        !e.includes('ResizeObserver') && // benign layout observer noise
        !e.includes('Service Worker') // SW registration races in test env
    )
    expect(fatalErrors, `Unhandled JS errors: ${fatalErrors.join('; ')}`).toHaveLength(0)
  })

  test('page has non-empty body — no blank screen on cold load', async ({ page }) => {
    await page.goto('/')
    const bodyText = await page.textContent('body')
    expect(bodyText?.trim().length ?? 0).toBeGreaterThan(10)
  })

  /**
   * Identity check, not just a placeholder check. `team/index.html` says
   * "Denel Staff"; the patient app's says "Denel Dental Clinic". Asserting the
   * exact string catches the split's worst deploy accident — the patient
   * bundle uploaded to the Team CF Pages project, or vice versa.
   */
  test('app title identifies the Team build (not "Vite App", not the patient app)', async ({
    page,
  }) => {
    await page.goto('/login')
    await expect(page).toHaveTitle('Denel Staff')
  })
})

// ─── 2. Routing ──────────────────────────────────────────────────────────────

test.describe('Team smoke — unauthenticated routing', () => {
  /**
   * Real guarded routes from `team/src/App.tsx`. Each sits behind
   * `RequireRole` → `RequireTeamAccess`, so an anonymous visitor is sent to
   * /login before any page chrome mounts.
   */
  const PROTECTED_ROUTES = [
    // staff hub
    '/dashboard',
    '/requests',
    '/requests/new',
    '/attendance',
    '/payslips',
    '/memos',
    '/training',
    '/profile',
    // lab tech tree
    '/lab/home',
    '/lab/jobs',
    // doctor tree — kept in App.tsx but unreachable by policy (doctors hold no
    // 'pwa' interface scope). It must still bounce anonymous visitors.
    '/doctor/home',
  ]

  for (const route of PROTECTED_ROUTES) {
    test(`"${route}" redirects to /login when unauthenticated`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login/, { timeout: NAV_TIMEOUT })
    })
  }

  test('"/" redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/, { timeout: NAV_TIMEOUT })
  })

  test('/login is reachable without authentication and shows the phone step', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByLabel(/phone number/i)).toBeVisible({ timeout: NAV_TIMEOUT })
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
  })

  /**
   * `/register/:token` is the public staff self-registration surface. It must
   * NOT be swept behind the auth guard — an invited staffer has no session
   * yet. With a bogus token it renders its own invalid-link state (or the
   * generic error state if the backend is unreachable); either way it stays
   * put rather than bouncing to /login.
   */
  test('/register/:token stays public — no bounce to /login', async ({ page }) => {
    await page.goto('/register/e2e-smoke-not-a-real-token')
    await expect(page).toHaveURL(/\/register\//, { timeout: NAV_TIMEOUT })
    await expect(page).not.toHaveURL(/\/login/)
  })
})

// ─── Routes that left this app in the split ──────────────────────────────────

test.describe('Team smoke — trees removed by the patient/team split', () => {
  /**
   * These used to live in `pwa/`. The patient self-service tree moved to the
   * `patient/` app and the training-authoring tree moved to `hr/`, so neither
   * has a route in `team/src/App.tsx` any more.
   *
   * The old spec asserted "not accessible by default (redirects to /login)".
   * The modern equivalent of that intent — this app does not serve these
   * surfaces — is that they fall through to the catch-all `*` route and render
   * the in-app 404. A redirect to /login here would be a REGRESSION: it would
   * mean the path matched a real route and the guard, rather than the router,
   * turned it away.
   *
   * (CF Pages SPA-fallback serves index.html for these paths, so the 404 is
   * client-side by design; the assertion is on what the app renders.)
   */
  const RELOCATED_ROUTES = [
    '/patient/home', // → patient/
    '/patient/appointments', // → patient/
    '/trainer/home', // → hr/
  ]

  for (const route of RELOCATED_ROUTES) {
    test(`"${route}" is not served by the Team app — renders the 404`, async ({ page }) => {
      await page.goto(route)
      await expect(page.getByText(/page not found/i)).toBeVisible({ timeout: NAV_TIMEOUT })
      await expect(page).not.toHaveURL(/\/login/)
    })
  }
})

// ─── 3. Login page security contract ─────────────────────────────────────────

test.describe('Team smoke — login page security contract', () => {
  test('phone field is a tel input with the right autofill hints', async ({ page }) => {
    await page.goto('/login')
    const phone = page.getByLabel(/phone number/i)
    await expect(phone).toBeVisible({ timeout: NAV_TIMEOUT })
    await expect(phone).toHaveAttribute('type', 'tel')
    await expect(phone).toHaveAttribute('autocomplete', 'tel')
    await expect(phone).toHaveAttribute('inputmode', 'tel')
  })

  /**
   * Regression guard for the split: Team sign-in is passwordless. A password
   * input, an "Account ID" field or a "Forgot password" link reappearing here
   * means the removed credential flow has crept back in.
   */
  test('no password credential affordances anywhere on the login page', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel(/phone number/i)).toBeVisible({ timeout: NAV_TIMEOUT })

    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await expect(page.getByLabel(/account id/i)).toHaveCount(0)
    await expect(page.getByRole('link', { name: /forgot password/i })).toHaveCount(0)
  })

  test('Continue button is present and labelled', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible({
      timeout: NAV_TIMEOUT,
    })
  })

  test('empty form submit stays on login — no navigation into the app', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel(/phone number/i)).toBeVisible({ timeout: NAV_TIMEOUT })
    // The phone input is `required`, so HTML5 validation blocks submission.
    await page.getByRole('button', { name: /continue/i }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('input[data-input-otp="true"]')).toHaveCount(0)
  })

  /**
   * The successor to the old "invalid credentials stay on login" test, and the
   * one assertion here that touches the backend.
   *
   * `0000000000` normalises to 233000000000 — well-formed (so it clears
   * `isValidPhoneNumber` and reaches the staff lookup) but deliberately one
   * below the seeded E2E range (+233000000001…5), so it can never match a real
   * row.
   *
   * `POST /api/staff-auth/login` answers an unknown phone with
   * `{ success: false, enabled: false }` and a generic message — no SMS, and no
   * account enumeration. The UI must therefore stay on the phone step: never
   * advancing to the OTP slots is the observable proof that no code was sent.
   *
   * Tolerates an unreachable backend (no response → the client shows its own
   * error and still stays put), which is what the CI job comment promises.
   */
  test('an unrecognised phone number never advances past the phone step', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel(/phone number/i)).toBeVisible({ timeout: NAV_TIMEOUT })

    const loginResponse = page
      .waitForResponse((r) => r.url().includes('/api/staff-auth/login'), { timeout: 15_000 })
      .catch(() => null)

    await page.getByLabel(/phone number/i).fill('0000000000')
    await page.getByRole('button', { name: /continue/i }).click()

    const res = await loginResponse
    if (res) {
      const body = (await res.json().catch(() => null)) as { success?: boolean } | null
      expect(body?.success, 'an unknown phone must not start an OTP session').not.toBe(true)
    }

    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('input[data-input-otp="true"]')).toHaveCount(0)
    await expect(page.getByLabel(/phone number/i)).toBeVisible()
  })
})

// ─── 4. PWA manifest ─────────────────────────────────────────────────────────

test.describe('Team smoke — PWA manifest', () => {
  /**
   * `team/vite.config.ts` sets `VitePWA({ devOptions: { enabled: false } })`,
   * so the dev server serves no manifest at all. This is only meaningful
   * against a built deploy — which is exactly where CI runs it. Locally it
   * skips rather than reporting a false failure.
   */
  test.skip(
    !process.env.CI,
    'vite-plugin-pwa devOptions are disabled — no manifest on the dev server. ' +
      'This asserts against a built/deployed app (the CI job does).'
  )

  test('manifest.webmanifest is served, parseable, and is the STAFF manifest', async ({ page }) => {
    const response = await page.goto('/manifest.webmanifest')
    expect(response, 'no response for /manifest.webmanifest').not.toBeNull()
    expect(response?.status(), 'the generated manifest must be served').toBe(200)

    const contentType = response?.headers()['content-type'] ?? ''
    expect(contentType).toMatch(/json|manifest/)

    const parsed = JSON.parse((await response?.text()) ?? '{}') as {
      name?: string
      short_name?: string
      start_url?: string
      display?: string
      icons?: unknown[]
    }
    // Same identity check as the <title> assertion — this is the Team app's
    // manifest, not the patient app's ("Denel Dental Clinic").
    expect(parsed.name).toBe('Denel Staff')
    expect(parsed.start_url).toBe('/')
    expect(parsed.display).toBe('standalone')
    expect(parsed.icons?.length ?? 0).toBeGreaterThan(0)
  })
})

// ─── 5. Data leakage ─────────────────────────────────────────────────────────

test.describe('Team smoke — no data leakage', () => {
  test('unauthenticated page body contains no raw error strings', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect(page.getByLabel(/phone number/i)).toBeVisible({ timeout: NAV_TIMEOUT })
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    const bodyText = (await page.textContent('body')) ?? ''

    expect(bodyText).not.toMatch(/\b23\d{3}\b/) // Postgres error codes
    expect(bodyText).not.toMatch(/Cannot read propert/i)
    expect(bodyText).not.toMatch(/TypeError.*at\s+\w+\s+\(/i)
    expect(bodyText).not.toMatch(/violates.*constraint/i)
  })

  test('login page does not expose API secrets in HTML source', async ({ page }) => {
    await page.goto('/login')
    const html = await page.content()

    expect(html).not.toMatch(/BETTER_AUTH_SECRET/)
    expect(html).not.toMatch(/DATABASE_URL/)
    expect(html).not.toMatch(/postgresql:\/\/[^@]+:[^@]+@/) // DB credentials
  })

  /**
   * Ported from the old "/patient/home must redirect, not flash patient data"
   * test. That tree lives in the `patient/` app now, so the page under test is
   * the Team 404 — but the property being defended is unchanged: nothing
   * reachable without a session may contain patient PII.
   */
  test('the 404 for a relocated patient route contains no patient PII', async ({ page }) => {
    await page.goto('/patient/home')
    await expect(page.getByText(/page not found/i)).toBeVisible({ timeout: NAV_TIMEOUT })
    const bodyText = (await page.textContent('body')) ?? ''

    expect(bodyText).not.toMatch(/\+233\d{9}/) // Ghana mobile number
    expect(bodyText).not.toMatch(/FD-\d{4}-[A-Z0-9]{4}/) // Patient ID (FD-YYMM-XXXX)
  })

  /**
   * The login page is the app's only pre-auth surface that makes a real
   * backend round trip (branding). It must not carry staff PII either.
   */
  test('login page contains no staff PII', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel(/phone number/i)).toBeVisible({ timeout: NAV_TIMEOUT })
    const bodyText = (await page.textContent('body')) ?? ''

    expect(bodyText).not.toMatch(/\+233\d{9}/) // Ghana mobile number
    expect(bodyText).not.toMatch(/\bFDM-[A-Z]?\d{4}\b/) // staffId format
  })
})
