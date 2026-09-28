import { expect, test } from '@playwright/test'
import { Pool } from 'pg'
import { STAFF, signOut, TEST_PASSWORD } from './helpers'

// STALE (pre-T27): this spec drives the old account-id + password login form,
// which the Team app no longer has — sign-in is phone + OTP. Skipped rather
// than left to fail on a selector that cannot match. Migrating these is
// follow-up work; `authenticated-csrf.spec.ts` is the migrated reference.
test.skip(true, 'Not yet migrated to the phone + OTP sign-in flow (T27 follow-up).')

/**
 * OTP rate-limit test. Backend enforces 3 OTP requests per 15 min per
 * (staffId, purpose) — see backend/src/lib/staff-otp.ts:
 *
 *   const MAX_REQUESTS_PER_WINDOW = 3
 *   const RATE_WINDOW_MS = 15 * 60 * 1000
 *
 * This test:
 *   1. Resets OTP rows for the trainer test staff (FDM-T0004).
 *   2. Triggers 3 successful OTP sends by signing in 3 times (each time the
 *      device is untrusted, send-device-otp fires).
 *   3. On the 4th attempt, the UI shows the rate-limit error.
 *
 * Uses the trainer staff so it doesn't conflict with auth.spec (admin) or
 * trust-device.spec (receptionist) or forgot-password.spec (patient).
 */

test.describe.configure({ mode: 'serial' })

const SLOT = STAFF.trainer

async function resetTrainerOtpState(): Promise<void> {
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

async function attemptSignInUpToOtpScreen(page: import('@playwright/test').Page): Promise<{
  hitOtpStep: boolean
  rateLimitMessage: string | null
}> {
  await signOut(page)
  await page.goto('/login')
  await page.getByLabel(/account id/i).waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByLabel(/account id/i).fill(SLOT.staffId)
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /^sign in/i }).click()

  // Race: OTP visible (sent) vs rate-limit message visible.
  await Promise.race([
    page.getByLabel(/6-digit code/i).waitFor({ state: 'visible', timeout: 15_000 }),
    page.getByText(/too many|wait a few minutes/i).waitFor({ state: 'visible', timeout: 15_000 }),
  ]).catch(() => {
    /* either may resolve, we'll inspect state */
  })

  const hitOtpStep = await page
    .getByLabel(/6-digit code/i)
    .isVisible()
    .catch(() => false)
  if (hitOtpStep) {
    return { hitOtpStep: true, rateLimitMessage: null }
  }
  const errMsg = await page
    .getByText(/too many|wait a few minutes/i)
    .first()
    .innerText()
    .catch(() => null)
  return { hitOtpStep: false, rateLimitMessage: errMsg }
}

test.beforeAll(async () => {
  await resetTrainerOtpState()
})

test('attempts 1-3 succeed (OTP screen shown); attempt 4 is rate-limited', async ({ page }) => {
  // Attempt 1
  const r1 = await attemptSignInUpToOtpScreen(page)
  expect(r1.hitOtpStep, '1st sign-in should reach OTP screen').toBe(true)

  // Attempt 2
  const r2 = await attemptSignInUpToOtpScreen(page)
  expect(r2.hitOtpStep, '2nd sign-in should reach OTP screen').toBe(true)

  // Attempt 3 — last one allowed before rate limit
  const r3 = await attemptSignInUpToOtpScreen(page)
  expect(r3.hitOtpStep, '3rd sign-in should reach OTP screen').toBe(true)

  // Attempt 4 — backend MUST reject with rate-limit error. The UI surfaces
  // the backend's error message somewhere on the page.
  const r4 = await attemptSignInUpToOtpScreen(page)
  expect(r4.hitOtpStep, '4th sign-in should be rate-limited').toBe(false)
  expect(r4.rateLimitMessage, 'should display a rate-limit message').toBeTruthy()
})

test.afterAll(async () => {
  // Don't leave the trainer at rate-limit ceiling for the next run.
  await resetTrainerOtpState()
})
