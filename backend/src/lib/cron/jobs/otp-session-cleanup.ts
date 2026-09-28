/**
 * Daily auth-table janitor.
 *
 * - patient_otp_codes: deletes rows past expiresAt
 * - patient_sessions: deletes rows past expiresAt
 * - patient_trusted_devices: deletes rows past expiresAt
 *
 * These tables grow unbounded otherwise — every patient login flow leaves
 * an OTP code, and every browser session leaves a row. Cleanup keeps the
 * tables fast for lookup.
 */

import { lt } from 'drizzle-orm'
import { env } from '../../../config/env'
import { getDb } from '../../../db'
import {
  patientOtpCodes,
  patientSessions,
  patientTrustedDevices,
} from '../../../db/schema/patients'
import type { JobContext, JobRunResult } from '../types'

export async function runOtpSessionCleanup(_ctx: JobContext): Promise<JobRunResult> {
  const db = getDb(env.DATABASE_URL)
  const now = new Date()

  const otpDeleted = await db
    .delete(patientOtpCodes)
    .where(lt(patientOtpCodes.expiresAt, now))
    .returning({ id: patientOtpCodes.id })

  const sessionsDeleted = await db
    .delete(patientSessions)
    .where(lt(patientSessions.expiresAt, now))
    .returning({ id: patientSessions.id })

  const devicesDeleted = await db
    .delete(patientTrustedDevices)
    .where(lt(patientTrustedDevices.expiresAt, now))
    .returning({ id: patientTrustedDevices.id })

  return {
    summary: `deleted otp:${otpDeleted.length} sessions:${sessionsDeleted.length} devices:${devicesDeleted.length}`,
    details: {
      otpDeleted: otpDeleted.length,
      sessionsDeleted: sessionsDeleted.length,
      devicesDeleted: devicesDeleted.length,
    },
  }
}
