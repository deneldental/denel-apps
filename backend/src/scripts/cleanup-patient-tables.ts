/**
 * cleanup-patient-tables — prune expired rows from time-limited patient tables.
 *
 * Tables pruned:
 *   - patient_sessions      (expiresAt < now)
 *   - patient_otp_codes     (expiresAt < now)
 *   - patient_trusted_devices (expiresAt < now)
 *
 * Run manually:  pnpm exec tsx src/scripts/cleanup-patient-tables.ts
 * Run via cron:  schedule this script nightly in your cron/scheduler.
 *
 * Safe to run at any time — deletes only rows where expiresAt is in the past.
 */

import { lt } from 'drizzle-orm'
import { getDb } from '../db'
import { patientOtpCodes, patientSessions, patientTrustedDevices } from '../db/schema'

async function cleanup() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set')
  const db = getDb(databaseUrl)
  const now = new Date()

  const [sessions, otps, devices] = await Promise.all([
    db
      .delete(patientSessions)
      .where(lt(patientSessions.expiresAt, now))
      .returning({ id: patientSessions.id }),
    db
      .delete(patientOtpCodes)
      .where(lt(patientOtpCodes.expiresAt, now))
      .returning({ id: patientOtpCodes.id }),
    db
      .delete(patientTrustedDevices)
      .where(lt(patientTrustedDevices.expiresAt, now))
      .returning({ id: patientTrustedDevices.id }),
  ])

  console.log(
    `[cleanup-patient-tables] Deleted ${sessions.length} sessions, ${otps.length} OTP codes, ${devices.length} trusted devices`
  )
}

cleanup().catch((err) => {
  console.error('[cleanup-patient-tables] Failed:', err)
  process.exit(1)
})
