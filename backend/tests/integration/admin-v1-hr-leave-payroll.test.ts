/**
 * Integration tests for §14.6 — HR leave → attendance → payroll.
 *
 * Proves the loop: an APPROVED **unpaid** leave request inside a pay period
 * becomes a payroll deduction (reduces earned gross / net), while approved
 * PAID leave (annual / sick) deducts nothing.
 *
 * Exercises the real `computeLeaveDeductions` service against Postgres inside
 * `withRollback`, so the shared dev DB is never mutated. The HTTP layer is not
 * spun up — this is a function-level integration test, matching the other HR
 * integration suites.
 */

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { computeLeaveDeductions } from '../../src/routes/staff-attendance'
import { noDb, withRollback } from './_setup'

/** Transient staff (+ linked auth user for the FK) inside the test tx. */
async function makeStaff(tx: any, name = 'Leave Payroll Staff'): Promise<{ staffId: string }> {
  const userId = `__it_user_${randomUUID().slice(0, 12)}`
  const now = new Date()
  await tx.insert(schema.user).values({
    id: userId,
    name,
    email: `${userId}@it.local`,
    emailVerified: true,
    role: null,
    roleId: null,
    banned: false,
    createdAt: now,
    updatedAt: now,
  })
  const [s] = await tx
    .insert(schema.staff)
    .values({
      staffId: `IT-${randomUUID().slice(0, 8)}`,
      userId,
      fullName: name,
      email: `${userId}@it.local`,
      employmentType: 'permanent',
      status: 'active',
      staffType: 'internal',
    })
    .returning()
  return { staffId: s.id }
}

async function makeLeave(
  tx: any,
  opts: {
    staffId: string
    subType: string
    startDate: string
    endDate: string
    status?: 'pending' | 'approved' | 'rejected'
  }
): Promise<string> {
  const [r] = await tx
    .insert(schema.staffRequests)
    .values({
      staffId: opts.staffId,
      requestType: 'leave',
      subType: opts.subType,
      startDate: new Date(opts.startDate),
      endDate: new Date(opts.endDate),
      status: opts.status ?? 'approved',
      urgencyLevel: 'normal',
      attachments: [],
    })
    .returning()
  return r.id
}

// May 2026: 1st is a Friday. Sundays in May 2026 fall on the 3, 10, 17, 24, 31.
const PERIOD_START = new Date('2026-05-01')
const PERIOD_END = new Date('2026-05-31')

describe.skipIf(noDb)('§14.6 — unpaid leave → payroll deduction', () => {
  it('approved UNPAID leave in the period produces a deduction (days + amount)', async () => {
    await withRollback(async (tx) => {
      const { staffId } = await makeStaff(tx, 'Unpaid Leave Staff')

      // Mon 2026-05-04 .. Fri 2026-05-08 — five working days, no Sunday inside.
      await makeLeave(tx, {
        staffId,
        subType: 'unpaid_leave',
        startDate: '2026-05-04',
        endDate: '2026-05-08',
        status: 'approved',
      })

      const res = await computeLeaveDeductions(tx as any, {
        staffId,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        monthlyGross: 6000,
      })

      expect(res.unpaidLeaveDays).toBe(5)
      expect(res.workingDaysInPeriod).toBeGreaterThan(0)
      // amount = (6000 / workingDaysInPeriod) * 5, rounded to 2dp.
      const expected = Math.round((6000 / res.workingDaysInPeriod) * 5 * 100) / 100
      expect(res.amount).toBeCloseTo(expected, 2)
      expect(res.amount).toBeGreaterThan(0)
      expect(res.breakdown).toHaveLength(1)
      expect(res.breakdown[0].subType).toBe('unpaid_leave')
      expect(res.breakdown[0].days).toBe(5)
    })
  })

  it('approved PAID leave (annual / sick) produces NO deduction', async () => {
    await withRollback(async (tx) => {
      const { staffId } = await makeStaff(tx, 'Paid Leave Staff')

      await makeLeave(tx, {
        staffId,
        subType: 'annual_leave',
        startDate: '2026-05-04',
        endDate: '2026-05-08',
        status: 'approved',
      })
      await makeLeave(tx, {
        staffId,
        subType: 'sick_leave',
        startDate: '2026-05-11',
        endDate: '2026-05-13',
        status: 'approved',
      })

      const res = await computeLeaveDeductions(tx as any, {
        staffId,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        monthlyGross: 6000,
      })

      expect(res.unpaidLeaveDays).toBe(0)
      expect(res.amount).toBe(0)
      expect(res.breakdown).toHaveLength(0)
    })
  })

  it('PENDING / rejected unpaid leave does not deduct — only approved counts', async () => {
    await withRollback(async (tx) => {
      const { staffId } = await makeStaff(tx, 'Pending Unpaid Staff')

      await makeLeave(tx, {
        staffId,
        subType: 'unpaid_leave',
        startDate: '2026-05-04',
        endDate: '2026-05-08',
        status: 'pending',
      })
      await makeLeave(tx, {
        staffId,
        subType: 'unpaid_leave',
        startDate: '2026-05-11',
        endDate: '2026-05-13',
        status: 'rejected',
      })

      const res = await computeLeaveDeductions(tx as any, {
        staffId,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        monthlyGross: 6000,
      })

      expect(res.unpaidLeaveDays).toBe(0)
      expect(res.amount).toBe(0)
    })
  })

  it('clips an unpaid-leave window that straddles the period boundary', async () => {
    await withRollback(async (tx) => {
      const { staffId } = await makeStaff(tx, 'Straddle Unpaid Staff')

      // Leave runs late April into early May; only the in-period days count,
      // and the working-day rubric skips only Sundays (Saturdays still count).
      await makeLeave(tx, {
        staffId,
        subType: 'unpaid_leave',
        startDate: '2026-04-28',
        endDate: '2026-05-05',
        status: 'approved',
      })

      const res = await computeLeaveDeductions(tx as any, {
        staffId,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        monthlyGross: 6000,
      })

      // In-period window is May 1..5. May 1 (Fri), May 2 (Sat), May 4 (Mon),
      // May 5 (Tue) all count; only May 3 (Sun) is skipped → 4 working days.
      expect(res.unpaidLeaveDays).toBe(4)
      expect(res.amount).toBeGreaterThan(0)
    })
  })

  it('honours per-staff off-days and clinic holidays when counting unpaid days', async () => {
    await withRollback(async (tx) => {
      const { staffId } = await makeStaff(tx, 'Offday Holiday Staff')

      // This staff is off every Wednesday (dayOfWeek 3); clinic holiday on Thu.
      await tx.insert(schema.staffOffDays).values({ staffId, dayOfWeek: 3 })
      await tx
        .insert(schema.clinicHolidays)
        .values({ date: '2026-05-07', name: 'IT Holiday' })
        .onConflictDoNothing()

      // Mon 4 .. Fri 8: Wed 6 is an off-day, Thu 7 is a holiday → 3 counted.
      await makeLeave(tx, {
        staffId,
        subType: 'unpaid_leave',
        startDate: '2026-05-04',
        endDate: '2026-05-08',
        status: 'approved',
      })

      const res = await computeLeaveDeductions(tx as any, {
        staffId,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        monthlyGross: 6000,
      })

      // Mon 4, Tue 5, Fri 8 — Wed 6 (off-day) + Thu 7 (holiday) excluded.
      expect(res.unpaidLeaveDays).toBe(3)
    })
  })

  it('zero / missing gross yields the day count with a zero amount', async () => {
    await withRollback(async (tx) => {
      const { staffId } = await makeStaff(tx, 'No Gross Staff')

      await makeLeave(tx, {
        staffId,
        subType: 'unpaid_leave',
        startDate: '2026-05-04',
        endDate: '2026-05-08',
        status: 'approved',
      })

      const res = await computeLeaveDeductions(tx as any, {
        staffId,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      })

      expect(res.unpaidLeaveDays).toBe(5)
      expect(res.amount).toBe(0)
    })
  })
})
