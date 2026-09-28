/**
 * settings-domain-audit S5-B (petty cash) against a real Postgres:
 *   - the review gate: at/below the approval limit a petty disbursement is
 *     auto-confirmed, above it stays pending;
 *   - the IOU cap: a staff member at the cap of pending disbursements is refused;
 *   - the box balance: latest replenishment minus petty spend since it
 *     (flagged rows excluded), with the low-float warning.
 * Everything runs inside withRollback.
 */
import { randomUUID } from 'node:crypto'
import { DEFAULT_PETTY_CASH_POLICY } from '@denel/utils'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { expenseCategories, expenses, pettyCashReplenishments, staff } from '../../src/db/schema'
import { getPettyCashBalance } from '../../src/lib/petty-cash-balance'
import { applyPettyCashReviewPolicy, PettyCashPolicyError } from '../../src/lib/petty-cash-policy'
import { anyUserId } from './_fixtures'
import { noDb, withRollback } from './_setup'

const policy = { ...DEFAULT_PETTY_CASH_POLICY, singleApprovalLimit: 500, maxActiveIousPerStaff: 2 }

async function pettyCategory(tx: DB) {
  const name = `it_petty_${randomUUID().slice(0, 8)}`
  await tx
    .insert(expenseCategories)
    .values({ name, displayName: 'IT Petty', isPettyCash: true, pettyRefType: 'staff' })
  return name
}

async function makeStaff(tx: DB) {
  const [row] = await tx
    .insert(staff)
    .values({
      staffId: `IT-${randomUUID().slice(0, 8)}`,
      fullName: 'IT Runner',
      employmentType: 'permanent',
    })
    .returning({ id: staff.id })
  return row.id
}

describe.skipIf(noDb)('petty cash policy (S5-B)', () => {
  it('review gate: auto-confirms at/below the limit, leaves the rest pending', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const below: Record<string, unknown> = {
        amount: 50_000,
        confirmationStatus: 'pending',
        pettyRefType: null,
        pettyRefId: null,
      }
      expect(await applyPettyCashReviewPolicy(tx, below, userId, policy)).toBe('auto_confirmed')
      expect(below.confirmationStatus).toBe('confirmed')
      expect(below.confirmedById).toBe(userId)
      expect(below.confirmationNote).toMatch(/auto-confirmed/i)

      const above: Record<string, unknown> = {
        amount: 50_001,
        confirmationStatus: 'pending',
        pettyRefType: null,
        pettyRefId: null,
      }
      expect(await applyPettyCashReviewPolicy(tx, above, userId, policy)).toBe('needs_review')
      expect(above.confirmationStatus).toBe('pending')

      const nonPetty: Record<string, unknown> = { amount: 10, confirmationStatus: null }
      expect(await applyPettyCashReviewPolicy(tx, nonPetty, userId, policy)).toBeNull()
    })
  })

  it('IOU cap: refuses a new staff disbursement once the pending count hits the cap', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const category = await pettyCategory(tx)
      const staffId = await makeStaff(tx)
      await tx.insert(expenses).values([
        {
          category,
          amount: 100_000,
          pettyRefType: 'staff',
          pettyRefId: staffId,
          confirmationStatus: 'pending',
          createdById: userId,
        },
        {
          category,
          amount: 100_000,
          pettyRefType: 'staff',
          pettyRefId: staffId,
          confirmationStatus: 'pending',
          createdById: userId,
        },
      ])
      const data: Record<string, unknown> = {
        amount: 1_000,
        confirmationStatus: 'pending',
        pettyRefType: 'staff',
        pettyRefId: staffId,
      }
      await expect(applyPettyCashReviewPolicy(tx, data, userId, policy)).rejects.toBeInstanceOf(
        PettyCashPolicyError
      )

      // Confirming one settles it; the next disbursement goes through.
      const [first] = await tx
        .select({ id: expenses.id })
        .from(expenses)
        .where((await import('drizzle-orm')).eq(expenses.pettyRefId, staffId))
      await tx
        .update(expenses)
        .set({ confirmationStatus: 'confirmed' })
        .where((await import('drizzle-orm')).eq(expenses.id, first.id))
      expect(await applyPettyCashReviewPolicy(tx, data, userId, policy)).toBe('auto_confirmed')
    })
  })

  it('balance: latest replenishment minus petty spend since it, flagged excluded', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const category = await pettyCategory(tx)
      const replenishedAt = new Date(Date.now() - 60 * 60 * 1000)
      await tx
        .insert(pettyCashReplenishments)
        .values({ date: replenishedAt, amount: 300_000, createdById: userId })
      const before = new Date(replenishedAt.getTime() - 60_000)
      const after = new Date(replenishedAt.getTime() + 60_000)
      await tx.insert(expenses).values([
        {
          category,
          amount: 9_000,
          date: before,
          confirmationStatus: 'confirmed',
          createdById: userId,
        },
        {
          category,
          amount: 5_000,
          date: after,
          confirmationStatus: 'confirmed',
          createdById: userId,
        },
        {
          category,
          amount: 1_000,
          date: after,
          confirmationStatus: 'pending',
          createdById: userId,
        },
        {
          category,
          amount: 2_000,
          date: after,
          confirmationStatus: 'flagged',
          createdById: userId,
        },
      ])

      const b = await getPettyCashBalance(
        tx,
        { ...policy, replenishWarningThreshold: 2_950 },
        new Date(after.getTime() + 1_000)
      )
      expect(b.source).toBe('replenishment')
      expect(b.floatAmount).toBe(300_000)
      expect(b.spentSince).toBe(6_000)
      expect(b.balance).toBe(294_000)
      expect(b.warningThreshold).toBe(295_000)
      expect(b.belowWarning).toBe(true)
      expect(b.approvalLimit).toBe(50_000)
    })
  })
})
