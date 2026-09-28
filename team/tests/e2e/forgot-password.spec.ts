import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { Pool } from 'pg'
import { PATIENT, readLatestOtp, signInAsPatient, signOut, TEST_PASSWORD } from './helpers'

// STALE (pre-T27): this spec drives the old account-id + password login form,
// which the Team app no longer has — sign-in is phone + OTP. Skipped rather
// than left to fail on a selector that cannot match. Migrating these is
// follow-up work; `authenticated-csrf.spec.ts` is the migrated reference.
test.skip(true, 'Not yet migrated to the phone + OTP sign-in flow (T27 follow-up).')

const API_BASE = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3000'
const STUB_FILE = process.env.SMS_STUB_FILE ?? 'F:/tmp/pwa-otp-stub.ndjson'

/**
 * Reset #P-TEST password via the patient forgot-password API directly —
 * no UI involvement. Used at suite start (idempotent if previous run left
 * #P-TEST with a stale password) and at suite end (cleanup belt-and-braces
 * after the UI test).
 *
 * Returns true if the reset succeeded; false otherwise. We don't fail the
 * suite on a failed reset — globalSetup also clears OTP rows, so the next
 * run still gets a clean slate.
 */
async function restorePatientPasswordViaApi(targetPassword: string): Promise<boolean> {
  // Step 1: request an OTP.
  const sendRes = await fetch(`${API_BASE}/api/patient-auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientId: PATIENT.patientId }),
  })
  if (!sendRes.ok) return false

  // Step 2: pluck the freshly written OTP from the stub file.
  // Poll the file because the OTP write is async after the API response.
  const deadline = Date.now() + 5000
  let code: string | null = null
  while (Date.now() < deadline && !code) {
    if (existsSync(STUB_FILE)) {
      const lines = readFileSync(STUB_FILE, 'utf8').trim().split('\n').filter(Boolean)
      for (let i = lines.length - 1; i >= 0; i--) {
        const entry = JSON.parse(lines[i]) as { message: string; type?: string }
        // Patient password-reset SMS contains "password" / "reset" hint.
        if (/reset|password/i.test(entry.message)) {
          const m = entry.message.match(/\b(\d{6})\b/)
          if (m) {
            code = m[1]
            break
          }
        }
      }
    }
    if (!code) await new Promise((r) => setTimeout(r, 200))
  }
  if (!code) return false

  // Step 3: reset to the target password.
  const resetRes = await fetch(`${API_BASE}/api/patient-auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patientId: PATIENT.patientId,
      code,
      newPassword: targetPassword,
    }),
  })
  return resetRes.ok
}

/**
 * Forgot-password full flow for the test PATIENT (#P-TEST).
 *
 * Patient flow steps:
 *   1. /forgot-password → enter patient ID → "Send OTP"
 *   2. backend sends SMS-OTP (captured by stub)
 *   3. UI: Verify Code → New Password (patient verifies code at reset step,
 *      so verify just advances)
 *   4. New password → backend verifies code + sets pwaPasswordHash
 *   5. Sign in with NEW password → expect OTP step (untrusted device)
 *
 * Restores the original password at the end so the rest of the test suite
 * (and #P-TEST as a manual test patient) keeps working.
 */

test.describe.configure({ mode: 'serial' })

const TEMP_PASSWORD = 'TempPass-9876'

async function resetPatientOtpRows(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl || !/neon\.tech/.test(dbUrl)) return
  const cleanUrl = dbUrl.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '')
  const pool = new Pool({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } })
  try {
    await pool.query(
      `DELETE FROM patient_otp_codes WHERE "patientId" IN (SELECT id FROM patients WHERE "patientId" = $1)`,
      [PATIENT.patientId]
    )
  } finally {
    await pool.end()
  }
}

test.beforeAll(async () => {
  await resetPatientOtpRows()
  // Make sure #P-TEST starts with the canonical password (in case a previous
  // failed run left TEMP_PASSWORD applied). Use the same API the test uses —
  // forgot-password → reset. Safe to fail; we just won't have known starting
  // state, which globalSetup may need to reconcile.
  await restorePatientPasswordViaApi(TEST_PASSWORD)
  await resetPatientOtpRows()
})

test.afterAll(async () => {
  // Belt-and-braces: even if the in-UI cleanup test below ran, do one more
  // direct restore. Independent of UI state.
  await restorePatientPasswordViaApi(TEST_PASSWORD)
  await resetPatientOtpRows()
})

test('patient forgot-password: request OTP → verify → reset to a new password', async ({
  page,
}) => {
  // ── Step 1: navigate from /login to /forgot-password ─────────────────────
  await signOut(page)
  await page.goto('/login')
  await page.getByRole('link', { name: /forgot password/i }).click()
  await expect(page).toHaveURL(/forgot-password/)

  // ── Step 2: request OTP ──────────────────────────────────────────────────
  const cutoff = new Date().toISOString()
  await page.getByLabel(/patient id|staff id/i).fill(PATIENT.patientId)
  await page.getByRole('button', { name: /send otp/i }).click()

  // UI advances to Verify Code step regardless of whether the account exists
  // (anti-enumeration). We KNOW #P-TEST exists, so an OTP will be in the stub.
  await expect(page.getByLabel(/otp code/i)).toBeVisible({ timeout: 10_000 })
  const code = await readLatestOtp(cutoff)
  await page.getByLabel(/otp code/i).fill(code)
  await page.getByRole('button', { name: /verify code/i }).click()

  // ── Step 3: enter new password ───────────────────────────────────────────
  await expect(page.getByLabel(/new password/i)).toBeVisible({ timeout: 10_000 })
  await page.getByLabel(/new password/i).fill(TEMP_PASSWORD)
  await page.getByLabel(/confirm password/i).fill(TEMP_PASSWORD)
  await page.getByRole('button', { name: /reset password/i }).click()

  // ── Step 4: success state — Sign In button is offered ────────────────────
  await expect(page.getByText(/password (has been )?(reset|changed)|successfully/i)).toBeVisible({
    timeout: 10_000,
  })

  // ── Step 5: verify the NEW password actually works ───────────────────────
  await page.goto('/login')
  await page.getByLabel(/account id/i).fill(PATIENT.patientId)
  await page.getByLabel(/^password$/i).fill(TEMP_PASSWORD)
  await page.getByRole('button', { name: /^sign in/i }).click()
  // Patient password reset revokes trusted devices, so we expect OTP again.
  await expect(page.getByLabel(/6-digit code/i)).toBeVisible({ timeout: 15_000 })
})

test('cleanup: restore seeded password via API, then sign in to confirm', async ({ page }) => {
  // afterAll also calls this, but doing it explicitly inside a test gives us
  // a visible pass/fail signal and lets us assert that the restore + sign-in
  // round-trip works end-to-end.
  const ok = await restorePatientPasswordViaApi(TEST_PASSWORD)
  expect(ok, 'restorePatientPasswordViaApi should succeed').toBe(true)

  await signOut(page)
  await signInAsPatient(page)
  await expect(page).toHaveURL(/\/patient\/home/)
})
