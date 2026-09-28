import { expect, test } from '@playwright/test'
import { Pool } from 'pg'
import { readLatestOtp, STAFF, signOut, TEST_PASSWORD } from './helpers'

// STALE (pre-T27): this spec drives the old account-id + password login form,
// which the Team app no longer has — sign-in is phone + OTP. Skipped rather
// than left to fail on a selector that cannot match. Migrating these is
// follow-up work; `authenticated-csrf.spec.ts` is the migrated reference.
test.skip(true, 'Not yet migrated to the phone + OTP sign-in flow (T27 follow-up).')

/**
 * Trust-device cookie persistence. Verifies the device-trust layer's
 * end-to-end contract:
 *
 *   1. First sign-in from a fresh browser → OTP required, cookie set.
 *   2. Subsequent sign-in from the SAME context (session cleared but the
 *      `staff_trusted_device` cookie persists) → OTP skipped.
 *   3. Clearing the trust cookie → next sign-in requires OTP again.
 *
 * Uses the receptionist staff (FDM-T0003) so we don't burn rate-limit slots
 * on admin (used by every other suite's auth tests).
 */

test.describe.configure({ mode: 'serial' })

const ROLE = 'receptionist' as const
const SLOT = STAFF[ROLE]

/**
 * Reset the staff member's OTP request log + trust device rows so the test
 * starts from a clean slate even if a previous run left state behind. The
 * test suite's globalSetup also does this, but this spec runs assertions
 * about the trust cookie specifically — we want the reset to be deterministic.
 */
async function resetTrustState(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl || !/neon\.tech/.test(dbUrl)) return
  const cleanUrl = dbUrl.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '')
  const pool = new Pool({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } })
  try {
    await pool.query(
      `DELETE FROM staff_otp_codes WHERE "staffId" IN (SELECT id FROM staff WHERE "staffId" = $1)`,
      [SLOT.staffId]
    )
    await pool.query(
      `DELETE FROM staff_trusted_devices WHERE "staffId" IN (SELECT id FROM staff WHERE "staffId" = $1)`,
      [SLOT.staffId]
    )
  } finally {
    await pool.end()
  }
}

test.beforeAll(async () => {
  await resetTrustState()
})

test('first sign-in requires OTP, sets trust cookie; subsequent sign-in skips OTP', async ({
  page,
  context,
}) => {
  // ── Phase 1: first sign-in, fresh browser → OTP required ───────────────
  await signOut(page)
  const cutoff1 = new Date().toISOString()
  await page.goto('/login')
  await page.getByLabel(/account id/i).waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByLabel(/account id/i).fill(SLOT.staffId)
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /^sign in/i }).click()

  await expect(page.getByLabel(/6-digit code/i)).toBeVisible({ timeout: 15_000 })
  const code1 = await readLatestOtp(cutoff1)
  await page.getByLabel(/6-digit code/i).fill(code1)
  await page.getByRole('button', { name: /verify/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 })

  // Confirm the trust cookie is now in the context.
  const cookies = await context.cookies()
  const trustCookie = cookies.find((c) => c.name === 'staff_trusted_device')
  expect(trustCookie, 'trust cookie should be set after successful OTP').toBeTruthy()

  // ── Phase 2: clear ONLY the session-related cookies, keep the trust one.
  // (Better Auth's `staff-pwa.session_token`, `staff-pwa.session_data`, etc.
  // are what get invalidated when a user signs out; the trust cookie is a
  // separate one our backend issues and is the lever under test here.)
  const sessionCookies = cookies.filter((c) => c.name.startsWith('staff-pwa.'))
  for (const c of sessionCookies) {
    await context.addCookies([{ ...c, expires: 0 }])
  }
  // The cleanest way to actually clear without re-adding: filter and reset.
  await context.clearCookies({ name: 'staff-pwa.session_token' })
  await context.clearCookies({ name: 'staff-pwa.session_data' })
  // Also clear localStorage so cached user state doesn't trick the SPA.
  await page.evaluate(() => {
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch {}
  })

  // ── Phase 3: sign in again, same context → OTP SHOULD be skipped ───────
  // After clearing the session cookies while on /dashboard, the staff
  // AuthProvider's auto-refresh will detect null user and navigate to
  // /login on its own. Our goto('/login') here can race with that
  // navigation and hit net::ERR_ABORTED. waitUntil:'commit' tolerates
  // that — we just need the URL to settle on /login eventually.
  await page.goto('/login', { waitUntil: 'commit' }).catch(() => {
    /* navigation was interrupted by SPA route change to /login — fine */
  })
  await page.waitForURL(/\/login/, { timeout: 15_000 })
  await page.getByLabel(/account id/i).waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByLabel(/account id/i).fill(SLOT.staffId)
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /^sign in/i }).click()

  // No OTP this time. We should navigate to the role home directly.
  // /dashboard for receptionist.
  await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 15_000 })
  await expect(page.getByLabel(/6-digit code/i)).not.toBeVisible()
})

test('clearing the trust cookie forces OTP on next sign-in', async ({ page, context }) => {
  // Previous test left the trust cookie set. Wipe it now and try to sign in.
  await context.clearCookies({ name: 'staff_trusted_device' })
  await signOut(page)

  await page.goto('/login')
  await page.getByLabel(/account id/i).waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByLabel(/account id/i).fill(SLOT.staffId)
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /^sign in/i }).click()

  // OTP screen MUST appear because the device is no longer trusted. If this
  // assertion fails, the backend is incorrectly trusting devices without a
  // valid cookie — investigate `isTrustedStaffDevice` in
  // backend/src/lib/staff-trusted-device.ts.
  await expect(page.getByLabel(/6-digit code/i)).toBeVisible({ timeout: 15_000 })
})
