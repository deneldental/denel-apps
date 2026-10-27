/**
 * F25 — case numbers survive a lost race. See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.13).
 *
 * A case is numbered CASE-nnnnn: the highest number in the table plus one. Two writers can read the
 * same highest number, and the unique index on `caseNumber` then refuses the second. The retry that
 * was meant to absorb this had two faults:
 *
 *   1. it asked `err.code === '23505'`, but Drizzle puts the Postgres code on `err.cause`, so it
 *      never saw a collision and rethrew the first one;
 *   2. it ran inside the caller's transaction (estimate confirm, treatment-plan create), and a failed
 *      INSERT aborts a Postgres transaction, so even a correct check could not have retried: every
 *      later statement would have failed with "current transaction is aborted".
 *
 * And `POST /api/patient-cases` had no retry at all. So a doctor's second click, or two receptionists
 * confirming estimates together, lost the whole operation. Each attempt now runs in its own
 * savepoint, as `lib/patient-id.ts` already does for patient ids.
 *
 * Real stack: real Postgres, real transactions, and a second connection that holds a number
 * uncommitted so the collision is certain, not hoped for.
 *
 * ── Safety ── commits rows; local Postgres only. Every row is removed in afterAll.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/patient-case-numbers.test.ts
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  getHubtelCredentials: vi.fn(async () => null),
}))

import type { DB } from '../../src/db'
import { patientCases, patients, treatmentPlans } from '../../src/db/schema'
import { ensureCaseForPlan, nextCaseNumber } from '../../src/lib/patient-case-service'
import {
  callAs,
  createLoginUser,
  deleteLoginUsers,
  hasBackendSecrets,
  isLocalDb,
  localDb,
  signInAs,
  type TestApp,
} from './_session'

const skip = !(isLocalDb && hasBackendSecrets)
const APP_BOOT_TIMEOUT_MS = 180_000
const db = localDb() as DB
const TAG = `IT case ${Date.now()}`

let patientId = ''
const planIds: string[] = []
const loginIds: string[] = []

async function newPlan() {
  const [plan] = await db
    .insert(treatmentPlans)
    .values({ patientId, title: `${TAG} plan ${planIds.length}` })
    .returning({ id: treatmentPlans.id })
  planIds.push(plan.id)
  return plan.id
}

/**
 * Another writer takes the next case number and keeps its transaction open. Anyone who picks the
 * same number now waits on its row in the unique index, and is refused the moment `commit()` runs.
 */
async function holdNextNumber() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let taken = ''
  let held!: () => void
  const isHeld = new Promise<void>((resolve) => {
    held = resolve
  })
  const writer = db.transaction(async (tx) => {
    taken = await nextCaseNumber(tx as DB)
    await tx.insert(patientCases).values({ patientId, caseNumber: taken })
    held()
    await gate
  })
  await isHeld
  return {
    taken,
    commit: async () => {
      release()
      await writer
    },
  }
}

/** A number picker that offers `first` once, then the real next number; remembers what it offered. */
function pickerStartingWith(first: string) {
  const offered: string[] = []
  let used = false
  const pick = async (d: DB) => {
    const n = used ? await nextCaseNumber(d) : first
    used = true
    offered.push(n)
    return n
  }
  return { pick, offered }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 500))

describe.skipIf(skip)('case numbers survive a lost race (F25)', () => {
  beforeAll(async () => {
    const [p] = await db
      .insert(patients)
      .values({ name: TAG, dob: new Date('1990-01-01'), gender: 'other', phone: '0240000062' })
      .returning({ id: patients.id })
    patientId = p.id
  }, 120_000)

  afterAll(async () => {
    await deleteLoginUsers(db, loginIds)
    if (!patientId) return
    // cases first (they point at plans), then plans, then the patient
    await db.delete(patientCases).where(eq(patientCases.patientId, patientId))
    if (planIds.length) await db.delete(treatmentPlans).where(inArray(treatmentPlans.id, planIds))
    await db.delete(patients).where(eq(patients.id, patientId))
  })

  it('takes the next free number when another writer is holding the one it picked', async () => {
    const other = await holdNextNumber()
    const { pick, offered } = pickerStartingWith(other.taken)

    const planId = await newPlan()
    const losing = ensureCaseForPlan(db, { planId, patientId }, pick)
    await settle() // it is now blocked behind the other writer's row
    await other.commit()
    const ensured = await losing

    expect(offered).toHaveLength(2) // it did collide, and it did retry
    expect(offered[0]).toBe(other.taken)
    expect(ensured.caseNumber).toBe(offered[1])
    expect(ensured.caseNumber).not.toBe(other.taken)
  })

  it('keeps the caller’s transaction usable after a collision (each attempt is a savepoint)', async () => {
    const other = await holdNextNumber()
    const { pick, offered } = pickerStartingWith(other.taken)

    const planId = await newPlan()
    const losing = db.transaction(async (tx) => {
      const ensured = await ensureCaseForPlan(tx as DB, { planId, patientId }, pick)
      // A poisoned transaction would refuse this read with "current transaction is aborted".
      const [row] = await tx.select().from(patientCases).where(eq(patientCases.id, ensured.id))
      return { ensured, row }
    })
    await settle()
    await other.commit()
    const result = await losing

    expect(offered).toHaveLength(2)
    expect(result.row.caseNumber).toBe(result.ensured.caseNumber)
    expect(result.ensured.caseNumber).not.toBe(other.taken)
  })

  it('reuses the case a plan already has instead of numbering a second one', async () => {
    const planId = await newPlan()
    const one = await ensureCaseForPlan(db, { planId, patientId })
    const two = await ensureCaseForPlan(db, { planId, patientId })
    expect(two).toEqual(one)
  })

  it(
    'gives six cases opened at the same moment six different numbers (POST /api/patient-cases)',
    async () => {
      vi.stubEnv('NODE_ENV', 'development')
      const { validateBackendEnv } = await import('../../src/config/env')
      validateBackendEnv()
      const app = (await import('../../src/app')).app as unknown as TestApp
      const email = `case-admin-${Date.now()}@cases.test`
      loginIds.push(
        await createLoginUser(db, { email, name: 'Case admin', roleId: 'admin', baRole: 'admin' })
      )
      const cookie = await signInAs(app, email, 'portal')

      const answers = await Promise.all(
        Array.from({ length: 6 }, () =>
          callAs(app, 'portal', cookie, 'POST', '/api/patient-cases', { patientId })
        )
      )

      expect(answers.map((a) => a.status)).toEqual([201, 201, 201, 201, 201, 201])
      const numbers = answers.map((a) => (a.json?.data as { caseNumber: string }).caseNumber)
      expect(new Set(numbers).size).toBe(6)
    },
    APP_BOOT_TIMEOUT_MS
  )
})
