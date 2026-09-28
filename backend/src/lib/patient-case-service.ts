// Patient-case helpers shared by every path that creates a treatment plan.
//
// A treatment plan is always the clinical content of a *case*: the case number
// (CASE-00001) is the identifier staff quote to each other and to the patient,
// while the plan's free-typed title is internal shorthand. So every plan gets a
// case, created alongside it — no plan is left without a case id.

import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { patientCases } from '../db/schema'

const CASE_PREFIX = 'CASE-'
const CASE_DIGITS = 5

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

/**
 * The case for a treatment plan — reused if one already points at the plan,
 * created otherwise.
 *
 * `caseNumber` is unique, so a concurrent insert can lose the race; we retry a
 * few times (re-reading the max each pass) instead of failing the plan write.
 */
export async function ensureCaseForPlan(
  db: DB,
  args: { planId: string; patientId: string; createdById?: string | null }
): Promise<EnsuredCase> {
  const [existing] = await db
    .select({ id: patientCases.id, caseNumber: patientCases.caseNumber })
    .from(patientCases)
    .where(eq(patientCases.planId, args.planId))
    .limit(1)
  if (existing) return existing

  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [created] = await db
        .insert(patientCases)
        .values({
          patientId: args.patientId,
          planId: args.planId,
          caseNumber: await nextCaseNumber(db),
          status: 'open',
          createdById: args.createdById ?? null,
        })
        .returning({ id: patientCases.id, caseNumber: patientCases.caseNumber })
      return created
    } catch (err) {
      // 23505 = unique_violation on caseNumber — another writer took it; retry.
      if ((err as { code?: string })?.code !== '23505') throw err
      lastError = err
    }
  }
  throw lastError
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
