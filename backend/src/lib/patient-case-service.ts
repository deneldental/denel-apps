// Patient-case helpers shared by every path that creates a treatment plan.
//
// A treatment plan is always the clinical content of a *case*: the case number
// (CASE-00001) is the identifier staff quote to each other and to the patient,
// while the plan's free-typed title is internal shorthand. So every plan gets a
// case, created alongside it — no plan is left without a case id.

import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { patientCases } from '../db/schema'
import { isUniqueViolation } from './pg-errors'

const CASE_PREFIX = 'CASE-'
const CASE_DIGITS = 5
/**
 * Numbers to try before giving up. Writers that picked the same number race for it and one wins per
 * round, so N writers at the same moment need up to N rounds; a clinic has a handful of people
 * opening cases at once, so twelve leaves room to spare.
 */
const CASE_NUMBER_ATTEMPTS = 12

/**
 * Next free case number.
 *
 * Derived from the highest numeric suffix already in the table rather than a
 * row count: counting breaks the moment a case is deleted (the next insert
 * reuses a taken number and trips the unique index).
 */
export async function nextCaseNumber(db: DB): Promise<string> {
  const [row] = await db
    .select({
      max: sql<number>`COALESCE(MAX(NULLIF(REGEXP_REPLACE("caseNumber", '[^0-9]', '', 'g'), '')::bigint), 0)::int`,
    })
    .from(patientCases)
  return `${CASE_PREFIX}${String((row?.max ?? 0) + 1).padStart(CASE_DIGITS, '0')}`
}

export type EnsuredCase = { id: string; caseNumber: string }

/** How the next number is chosen. A test passes its own to manufacture a collision. */
export type NextCaseNumber = (db: DB) => Promise<string>

/**
 * Insert a case under the next free number, trying again with a fresh number when another writer
 * takes it first.
 *
 * Two things have to be right for that retry to work at all, and the first version had neither:
 *
 *   1. Detecting the collision. Drizzle wraps the driver's error, so the SQLSTATE is on
 *      `err.cause`, not `err.code` (see lib/pg-errors.ts).
 *   2. Surviving it. A failed INSERT aborts the surrounding Postgres transaction, so every
 *      statement after it would fail with "current transaction is aborted". Each attempt therefore
 *      runs in its own SAVEPOINT (a transaction of its own when `db` is the pool); a collision rolls
 *      back to it and leaves the caller's transaction intact. The number is read inside the attempt,
 *      so the next one sees whatever the winner committed.
 *
 * Only a unique violation is retried; any other failure surfaces at once.
 */
export async function insertCase(
  db: DB,
  values: Omit<typeof patientCases.$inferInsert, 'caseNumber'>,
  nextNumber: NextCaseNumber = nextCaseNumber
): Promise<typeof patientCases.$inferSelect> {
  let lastError: unknown
  for (let attempt = 0; attempt < CASE_NUMBER_ATTEMPTS; attempt++) {
    try {
      return await db.transaction(async (savepoint) => {
        const caseNumber = await nextNumber(savepoint as unknown as DB)
        const [created] = await savepoint
          .insert(patientCases)
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

/**
 * The case for a treatment plan — reused if one already points at the plan,
 * created otherwise.
 *
 * `caseNumber` is unique, so a concurrent insert can lose the race; `insertCase` retries
 * with a fresh number instead of failing the plan write.
 */
export async function ensureCaseForPlan(
  db: DB,
  args: { planId: string; patientId: string; createdById?: string | null },
  nextNumber: NextCaseNumber = nextCaseNumber
): Promise<EnsuredCase> {
  const [existing] = await db
    .select({ id: patientCases.id, caseNumber: patientCases.caseNumber })
    .from(patientCases)
    .where(eq(patientCases.planId, args.planId))
    .limit(1)
  if (existing) return existing

  const created = await insertCase(
    db,
    {
      patientId: args.patientId,
      planId: args.planId,
      status: 'open',
      createdById: args.createdById ?? null,
    },
    nextNumber
  )
  return { id: created.id, caseNumber: created.caseNumber }
}

/**
 * Attach a freshly created plan to an existing (open) case that has no plan
 * yet, so a plan authored from inside a case doesn't spawn a second case
 * number for the same episode of care. Returns the linked case, or null when
 * the case already carries a different plan (caller should create a new case).
 */
export async function linkPlanToCase(
  db: DB,
  args: { caseId: string; planId: string }
): Promise<EnsuredCase | null> {
  const [linked] = await db
    .update(patientCases)
    .set({ planId: args.planId, updatedAt: new Date() })
    .where(and(eq(patientCases.id, args.caseId), isNull(patientCases.planId)))
    .returning({ id: patientCases.id, caseNumber: patientCases.caseNumber })
  return linked ?? null
}
