/**
 * Global setup — runs once before the Team E2E suite.
 *
 * Team sign-in is passwordless: phone number → 6-digit SMS code. To drive it
 * from Playwright the backend must run with `SMS_STUB_FILE` set, which makes
 * `backend/src/lib/sms.ts` append every outgoing message to that file as NDJSON
 * instead of calling Hubtel. This setup:
 *
 *   1. Truncates the SMS stub file, so "read the latest OTP" can never pick up
 *      a stale code from an earlier run.
 *   2. Clears the OTP rate-limit rows (3 sends / 15 min / staff) and the
 *      trusted-device rows for the FDM-T* test staff, so every run starts on an
 *      untrusted device and actually exercises the OTP step.
 *   3. (LOCAL POSTGRES ONLY) Re-asserts one distinct phone number per test staff
 *      row. `seed-test-pwa-staff.ts` now seeds exactly these numbers, so on a
 *      freshly seeded DB this is a no-op — it is kept as a repair step because
 *      local DBs are routinely cloned from Neon or seeded by an older script
 *      version, where all five rows still share `+233000000001`. Duplicates are
 *      no longer tie-broken: `findActiveStaffByPhone` refuses an ambiguous
 *      match outright, so a stale clone would fail EVERY Team sign-in test.
 *
 * SAFETY. Two databases are acceptable: the Neon *dev* branch (read + narrow
 * deletes only, matching the previous behaviour) and a local Postgres. Anything
 * else aborts. The phone reassignment in step 3 is an UPDATE, so it is gated to
 * localhost — the shared Neon dev DB is used concurrently by other work and
 * must not have its staff rows rewritten.
 */

import { existsSync, writeFileSync } from 'node:fs'
import { Pool } from 'pg'

/** staffId → the phone that staff row must own for role-specific sign-in. */
export const STAFF_PHONES: Record<string, string> = {
  'FDM-T0001': '+233000000001', // admin        — no `pwa` scope (gate test)
  'FDM-T0002': '+233000000002', // doctor       — no `pwa` scope
  'FDM-T0003': '+233000000003', // receptionist — HAS `pwa` scope
  'FDM-T0004': '+233000000004', // trainer      — no `pwa` scope
  'FDM-T0005': '+233000000005', // lab tech     — HAS `pwa` scope
}

export function isLocalDb(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(url)
}

export default async function globalSetup(): Promise<void> {
  // 1. Reset the SMS stub.
  const stubFile = process.env.SMS_STUB_FILE ?? 'F:/tmp/pwa-otp-stub.ndjson'
  writeFileSync(stubFile, '')
  if (!existsSync(stubFile)) {
    throw new Error(`Could not create SMS stub file at ${stubFile}`)
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.warn('[e2e globalSetup] DATABASE_URL not set; skipping DB reset.')
    return
  }
  const local = isLocalDb(dbUrl)
  if (!local && !/neon\.tech/.test(dbUrl)) {
    throw new Error(
      '[e2e globalSetup] Refusing to run: DATABASE_URL must be a local Postgres or the Neon dev branch.'
    )
  }

  const cleanUrl = dbUrl.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '')
  const pool = new Pool({
    connectionString: cleanUrl,
    ssl: local ? false : { rejectUnauthorized: false },
  })
  try {
    // 2. OTP + trusted-device rows for the test staff and the test patient.
    const otpDel = await pool.query(`
      DELETE FROM staff_otp_codes
      WHERE "staffId" IN (SELECT id FROM staff WHERE "staffId" LIKE 'FDM-T%')
    `)
    const trustDel = await pool.query(`
      DELETE FROM staff_trusted_devices
      WHERE "staffId" IN (SELECT id FROM staff WHERE "staffId" LIKE 'FDM-T%')
    `)
    const ptOtpDel = await pool.query(`
      DELETE FROM patient_otp_codes
      WHERE "patientId" IN (SELECT id FROM patients WHERE "patientId" = '#P-TEST')
    `)
    const ptTrustDel = await pool.query(`
      DELETE FROM patient_trusted_devices
      WHERE "patientId" IN (SELECT id FROM patients WHERE "patientId" = '#P-TEST')
    `)
    console.log(
      `[e2e globalSetup] cleared staff: ${otpDel.rowCount} otp rows, ${trustDel.rowCount} trust rows; patient: ${ptOtpDel.rowCount} otp, ${ptTrustDel.rowCount} trust`
    )

    // 3. Distinct phone per test staff — local Postgres only.
    if (local) {
      for (const [staffId, phone] of Object.entries(STAFF_PHONES)) {
        await pool.query(`UPDATE staff SET phone = $1 WHERE "staffId" = $2`, [phone, staffId])
      }
      console.log('[e2e globalSetup] assigned a distinct phone to each FDM-T* staff row')
    } else {
      console.warn(
        '[e2e globalSetup] Neon dev DB — skipping the phone reassignment (read-mostly). ' +
          'Role-specific sign-in tests will be skipped.'
      )
    }
  } finally {
    await pool.end()
  }
}
