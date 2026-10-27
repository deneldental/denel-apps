/**
 * Patient IDs (FD-YYMM-XXXX) and inserting a patient under one.
 *
 * The suffix is four random characters from a 32-character alphabet — about
 * 1.2 million values a month — and `patients.patientId` is unique. Collisions
 * are rare but real, so the insert retries with a fresh suffix. Two things have
 * to be right for that retry to work at all, and the first version of it had
 * neither:
 *
 *   1. Detecting the collision. Drizzle wraps the driver's error, so the
 *      SQLSTATE is on `err.cause`, not `err.code` (see lib/pg-errors.ts).
 *   2. Surviving it. A failed INSERT aborts the surrounding Postgres
 *      transaction, so every statement after it fails with "current
 *      transaction is aborted". Each attempt therefore runs in its own
 *      SAVEPOINT; a collision rolls back to it and leaves the caller's
 *      transaction (and any advisory lock it holds) intact.
 */

import type { DB } from '../db'
import { patients } from '../db/schema'
import { isUniqueViolation } from './pg-errors'

/** No I, O, 0 or 1 — they get misread when an ID is read out or hand-copied. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const SUFFIX_LENGTH = 4
const PATIENT_ID_CONSTRAINT = 'patients_patientId_unique'
const DEFAULT_ATTEMPTS = 5

/** `FD-YYMM-XXXX`. `now` and `random` are injectable so tests don't depend on the clock or luck. */
export function generatePatientId(
  now: Date = new Date(),
  random: () => number = Math.random
): string {
  let suffix = ''
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += ALPHABET.charAt(Math.floor(random() * ALPHABET.length))
  }
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `FD-${yy}${mm}-${suffix}`
}

type NewPatient = Omit<typeof patients.$inferInsert, 'patientId'>

/**
 * Insert a patient, assigning a patient ID and retrying with a new one if the
 * ID is already taken. Only an ID collision is retried; any other failure
 * surfaces immediately.
 *
 * `tx` may be a transaction handle — each attempt nests as a savepoint.
 * `nextId` is the seam that lets a test manufacture a collision.
 */
export async function insertPatientWithUniqueId(
  tx: DB,
  values: NewPatient,
  nextId: () => string = generatePatientId,
  maxAttempts: number = DEFAULT_ATTEMPTS
): Promise<typeof patients.$inferSelect> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await tx.transaction(async (savepoint) => {
        const [row] = await savepoint
          .insert(patients)
          .values({ ...values, patientId: nextId() })
          .returning()
        return row
      })
    } catch (err) {
      if (!isUniqueViolation(err, PATIENT_ID_CONSTRAINT)) throw err
      lastError = err
    }
  }
  throw lastError
}
