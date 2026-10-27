// Lab-case numbering. A lab case is quoted by its number (LC-000123) to the lab, the patient and
// the front desk, so two cases must never share one.

import { sql } from 'drizzle-orm'
import type { DB } from '../db'
import { labCases } from '../db/schema'
import { isUniqueViolation } from './pg-errors'

const LAB_CASE_PREFIX = 'LC-'
const LAB_CASE_DIGITS = 6
/**
 * Numbers to try before giving up. Writers that picked the same number race for it and one wins per
 * round, so N writers at the same moment need up to N rounds.
 */
export const LAB_CASE_ATTEMPTS = 8

/**
 * The next lab-case number: the highest `LC-` number in the table plus one.
 *
 * This used to read the most recently CREATED row and add one to its number, so as soon as rows were
 * not in number order (an import, a restore, a case created with a back-dated clock) it offered a
 * number that was already taken. It counts only numbers it could have issued (`LC-` and up to nine
 * digits), so a stray value cannot break the query either.
 */
export async function nextLabCaseNumber(db: DB): Promise<string> {
  const [row] = await db
    .select({
      max: sql<number | null>`max(substring("caseNumber" from '^LC-([0-9]{1,9})$')::int)`,
    })
    .from(labCases)
  return `${LAB_CASE_PREFIX}${String((row?.max ?? 0) + 1).padStart(LAB_CASE_DIGITS, '0')}`
}

/** How the next number is chosen. A test passes its own to manufacture a collision. */
export type NextLabCaseNumber = (db: DB) => Promise<string>

/**
 * Insert a lab case under the next free number, trying again with a fresh number when another
 * writer takes it first. Two requests that read the same highest number both insert it, and the
 * unique index refuses the second: that request used to fail with the database's own message.
 *
 * Each attempt runs in its own transaction (a savepoint when `db` is already one), so a refused
 * insert cannot poison what the caller does next, and the number is read inside the attempt so the
 * retry sees what the winner committed. Only a unique violation is retried.
 */
export async function insertLabCase(
  db: DB,
  values: Omit<typeof labCases.$inferInsert, 'caseNumber'>,
  nextNumber: NextLabCaseNumber = nextLabCaseNumber
): Promise<typeof labCases.$inferSelect> {
  let lastError: unknown
  for (let attempt = 0; attempt < LAB_CASE_ATTEMPTS; attempt++) {
    try {
      return await db.transaction(async (savepoint) => {
        const caseNumber = await nextNumber(savepoint as unknown as DB)
        const [created] = await savepoint
          .insert(labCases)
          .values({ ...values, caseNumber })
          .returning()
        return created
      })
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      lastError = err
    }
  }
  throw lastError
}
