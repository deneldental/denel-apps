/**
 * admin-v1 §15.1 + §15.2 — mandatory / recurring training smoke tests.
 *
 *  §15.1 — reopenExpiredTraining: a completed recurring assignment whose
 *          expiresAt has passed is re-opened (status → not_started, completion
 *          cleared, dueDate rolled forward); a not-yet-expired one is left
 *          alone; a completed row missing expiresAt is backfilled. Plus the
 *          pure helpers (computeExpiresAt, deriveTrainingStatus).
 *  §15.2 — bulkAssignTraining: fan-out to every active staff member in a role,
 *          idempotent on re-run, external trainers excluded.
 *
 * Run with `doppler run -- pnpm --filter backend test admin-v1-training`
 * (gated on DATABASE_URL). Every test runs inside `withRollback` — the shared
 * dev DB is never mutated.
 */

import { randomUUID } from 'node:crypto'
import { addMonths } from 'date-fns'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import * as schema from '../../src/db/schema'
import {
  bulkAssignTraining,
  computeExpiresAt,
  deriveTrainingStatus,
  reopenExpiredTraining,
} from '../../src/lib/training-renewal'
import { noDb, withRollback } from './_setup'

// ─── fixtures (mirror hr-routes.test.ts) ─────────────────────────────────────

async function makeUser(tx: DB, opts: { role?: string | null } = {}): Promise<string> {
  const userId = `__it_user_${randomUUID().slice(0, 12)}`
  const now = new Date()
  await tx.insert(schema.user).values({
    id: userId,
    name: 'IT User',
    email: `${userId}@it.local`,
    emailVerified: true,
    role: opts.role ?? null,
    roleId: null,
    banned: false,
    createdAt: now,
    updatedAt: now,
  })
  return userId
}

async function makeStaff(
  tx: DB,
  opts: {
    role?: string | null
    status?: 'active' | 'inactive' | 'suspended'
    isExternalTrainer?: boolean
  } = {}
): Promise<{ staffId: string; userId: string }> {
  const userId = await makeUser(tx, { role: opts.role ?? null })
  const [s] = await tx
    .insert(schema.staff)
    .values({
      staffId: `IT-${randomUUID().slice(0, 8)}`,
      userId,
      fullName: 'IT Staff',
      email: `${userId}@it.local`,
      employmentType: 'permanent',
      status: opts.status ?? 'active',
      staffType: 'internal',
      isExternalTrainer: opts.isExternalTrainer ?? false,
    })
    .returning()
  return { staffId: s.id, userId }
}

async function makeMaterial(tx: DB, uploadedById: string): Promise<string> {
  const [m] = await tx
    .insert(schema.trainingMaterials)
    .values({
      title: `IT Training ${randomUUID().slice(0, 6)}`,
      materialType: 'module',
      isMandatory: true,
      published: true,
      uploadedById,
    })
    .returning()
  return m.id
}

async function getProgress(tx: DB, staffId: string, trainingId: string) {
  return tx.query.staffTrainingProgress.findFirst({
    where: and(
      eq(schema.staffTrainingProgress.staffId, staffId),
      eq(schema.staffTrainingProgress.trainingId, trainingId)
    ),
  })
}

// ════════════════════════════════════════════════════════════════════════════
// §15.1 — pure helpers
// ════════════════════════════════════════════════════════════════════════════

describe('§15.1 — renewal helpers (pure)', () => {
  it('computeExpiresAt = completedAt + renewalMonths; null for one-off', () => {
    const done = new Date('2026-01-15T00:00:00.000Z')
    expect(computeExpiresAt(done, 12)?.toISOString()).toBe(addMonths(done, 12).toISOString())
    expect(computeExpiresAt(done, null)).toBeNull()
    expect(computeExpiresAt(done, 0)).toBeNull()
    expect(computeExpiresAt(null, 12)).toBeNull()
  })

  it('deriveTrainingStatus layers due/overdue/expired correctly', () => {
    const now = new Date('2026-06-10T00:00:00.000Z')
    const past = new Date('2026-01-01T00:00:00.000Z')
    const future = new Date('2026-12-01T00:00:00.000Z')

    // completed + expiry in the past → expired
    expect(deriveTrainingStatus({ status: 'completed', expiresAt: past }, now)).toBe('expired')
    // completed + expiry in the future → completed
    expect(deriveTrainingStatus({ status: 'completed', expiresAt: future }, now)).toBe('completed')
    // completed one-off (no expiry) → completed
    expect(deriveTrainingStatus({ status: 'completed' }, now)).toBe('completed')
    // not started + due date passed → overdue
    expect(deriveTrainingStatus({ status: 'not_started', dueDate: past }, now)).toBe('overdue')
    // not started + due date upcoming → due
    expect(deriveTrainingStatus({ status: 'not_started', dueDate: future }, now)).toBe('due')
    // in progress, no dates → in_progress
    expect(deriveTrainingStatus({ status: 'in_progress' }, now)).toBe('in_progress')
    // not started, no dates → not_started
    expect(deriveTrainingStatus({ status: 'not_started' }, now)).toBe('not_started')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// §15.1 — reopenExpiredTraining (DB)
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(noDb)('§15.1 — reopenExpiredTraining', () => {
  it('re-opens an expired recurring assignment and leaves a current one alone', async () => {
    await withRollback(async (tx) => {
      const admin = await makeUser(tx, { role: 'admin' })
      const { staffId } = await makeStaff(tx)
      const trainingId = await makeMaterial(tx, admin)

      const now = new Date()
      const completedLongAgo = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000)

      // Expired: completed a year+ ago, 12-month cycle, expiresAt in the past.
      await tx.insert(schema.staffTrainingProgress).values({
        staffId,
        trainingId,
        status: 'completed',
        progressPercent: 100,
        score: 90,
        completedAt: completedLongAgo,
        renewalMonths: 12,
        expiresAt: computeExpiresAt(completedLongAgo, 12),
        certificateIssued: true,
      })

      // A second, current assignment on a different material must be untouched.
      const other = await makeMaterial(tx, admin)
      const completedRecently = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      await tx.insert(schema.staffTrainingProgress).values({
        staffId,
        trainingId: other,
        status: 'completed',
        progressPercent: 100,
        score: 88,
        completedAt: completedRecently,
        renewalMonths: 12,
        expiresAt: computeExpiresAt(completedRecently, 12),
      })

      const result = await reopenExpiredTraining(tx, now)
      expect(result.reopened).toBeGreaterThanOrEqual(1)

      const reopened = await getProgress(tx, staffId, trainingId)
      expect(reopened?.status).toBe('not_started')
      expect(reopened?.completedAt).toBeNull()
      expect(reopened?.score).toBeNull()
      expect(reopened?.progressPercent).toBe(0)
      expect(reopened?.certificateIssued).toBe(false)
      expect(reopened?.expiresAt).toBeNull()
      // dueDate rolled forward to the cycle boundary that just passed.
      expect(reopened?.dueDate).not.toBeNull()

      const untouched = await getProgress(tx, staffId, other)
      expect(untouched?.status).toBe('completed')
      expect(untouched?.completedAt).not.toBeNull()
    })
  })

  it('backfills expiresAt for a completed recurring row missing it, then is idempotent', async () => {
    await withRollback(async (tx) => {
      const admin = await makeUser(tx, { role: 'admin' })
      const { staffId } = await makeStaff(tx)
      const trainingId = await makeMaterial(tx, admin)

      const now = new Date()
      // Completed recently, recurring, but expiresAt never stamped (legacy row).
      const completedRecently = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
      await tx.insert(schema.staffTrainingProgress).values({
        staffId,
        trainingId,
        status: 'completed',
        progressPercent: 100,
        completedAt: completedRecently,
        renewalMonths: 12,
        expiresAt: null,
      })

      const first = await reopenExpiredTraining(tx, now)
      expect(first.backfilled).toBeGreaterThanOrEqual(1)

      const row = await getProgress(tx, staffId, trainingId)
      // Still completed (cycle hasn't elapsed), but expiresAt now stamped.
      expect(row?.status).toBe('completed')
      expect(row?.expiresAt).not.toBeNull()
      expect(new Date(row?.expiresAt as Date).toISOString()).toBe(
        addMonths(completedRecently, 12).toISOString()
      )

      // Idempotent: a second sweep backfills nothing new.
      const second = await reopenExpiredTraining(tx, now)
      expect(second.backfilled).toBe(0)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// §15.2 — bulkAssignTraining
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(noDb)('§15.2 — bulkAssignTraining', () => {
  it('fans out to every active staff in a role and is idempotent on re-run', async () => {
    await withRollback(async (tx) => {
      const admin = await makeUser(tx, { role: 'admin' })
      const trainingId = await makeMaterial(tx, admin)

      // Three doctors (target role), one receptionist (other role),
      // one inactive doctor, one external-trainer doctor (both excluded).
      const d1 = await makeStaff(tx, { role: 'doctor' })
      const d2 = await makeStaff(tx, { role: 'doctor' })
      const d3 = await makeStaff(tx, { role: 'doctor' })
      const recep = await makeStaff(tx, { role: 'receptionist' })
      const inactiveDoc = await makeStaff(tx, { role: 'doctor', status: 'inactive' })
      const trainerDoc = await makeStaff(tx, { role: 'doctor', isExternalTrainer: true })

      const dueDate = new Date('2026-09-01T00:00:00.000Z')
      const res = await bulkAssignTraining(tx, trainingId, {
        role: 'doctor',
        dueDate,
        renewalMonths: 12,
      })

      // Only the three active, internal doctors are matched + assigned.
      expect(res.matched).toBe(3)
      expect(res.assigned).toBe(3)
      expect(res.skipped).toBe(0)

      for (const d of [d1, d2, d3]) {
        const p = await getProgress(tx, d.staffId, trainingId)
        expect(p).toBeTruthy()
        expect(p?.renewalMonths).toBe(12)
        expect(new Date(p?.dueDate as Date).toISOString()).toBe(dueDate.toISOString())
      }
      // Non-targets got nothing.
      expect(await getProgress(tx, recep.staffId, trainingId)).toBeUndefined()
      expect(await getProgress(tx, inactiveDoc.staffId, trainingId)).toBeUndefined()
      expect(await getProgress(tx, trainerDoc.staffId, trainingId)).toBeUndefined()

      // Idempotency — re-run assigns nothing new, all three skipped.
      const second = await bulkAssignTraining(tx, trainingId, { role: 'doctor' })
      expect(second.matched).toBe(3)
      expect(second.assigned).toBe(0)
      expect(second.skipped).toBe(3)
    })
  })

  it('rejects an empty filter and an unknown material', async () => {
    await withRollback(async (tx) => {
      const admin = await makeUser(tx, { role: 'admin' })
      const trainingId = await makeMaterial(tx, admin)

      await expect(bulkAssignTraining(tx, trainingId, {})).rejects.toThrow(/requires a role/)
      await expect(bulkAssignTraining(tx, randomUUID(), { role: 'doctor' })).rejects.toThrow(
        /not found/i
      )
    })
  })
})
