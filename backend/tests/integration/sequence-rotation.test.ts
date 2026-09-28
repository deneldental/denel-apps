/**
 * Regression test for H12 — `nextNumber` year rotation.
 *
 * The bug: the rotation guard was `current_year !== docYear`, and the UPDATE
 * wrote `current_year = docYear` unconditionally. So a *backdated* document
 * (dated in an earlier year than we've already issued numbers for) reset the
 * shared counter to 1 AND dragged `current_year` backward — after which the
 * next normally-dated document also "rotated" and re-issued numbers that were
 * already handed out.
 *
 * The fix: `current_year` only ever moves forward; the counter restarts only
 * on a genuine forward rotation; a backdated document keeps the monotonic
 * counter and just stamps its own year into the prefix.
 */

import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { numberSequences } from '../../src/db/schema'
import { nextNumber } from '../../src/lib/sequence-service'
import { noDb, withRollback } from './_setup'

describe.skipIf(noDb)('nextNumber — year rotation [H12]', () => {
  it('a backdated document never resets or rewinds the shared counter', async () => {
    await withRollback(async (tx) => {
      // Known starting state: current year 2026, next number 100.
      await tx
        .update(numberSequences)
        .set({
          prefix: 'INV-',
          yearSegment: true,
          currentYear: 2026,
          nextNumber: 100,
          padding: 5,
        })
        .where(eq(numberSequences.sequenceKey, 'invoice'))

      // 1. A current-year document gets 100.
      const a = await nextNumber(tx, 'invoice', new Date('2026-06-01'))
      expect(a).toBe('INV-2026-00100')

      // 2. A BACKDATED (2025) document must NOT reset the counter to 1 and must
      //    NOT drag current_year backward — it gets its own year in the prefix
      //    but the next shared number (101).
      const b = await nextNumber(tx, 'invoice', new Date('2025-06-01'))
      expect(b).toBe('INV-2025-00101')

      // 3. The next current-year document must continue from 102. The H12 bug
      //    rewound current_year to 2025 in step 2, which made this call falsely
      //    "rotate" and restart at 1 — re-issuing 'INV-2026-00100'.
      const c = await nextNumber(tx, 'invoice', new Date('2026-07-01'))
      expect(c).toBe('INV-2026-00102')

      const row = await tx.query.numberSequences.findFirst({
        where: eq(numberSequences.sequenceKey, 'invoice'),
      })
      expect(row?.currentYear).toBe(2026)
      expect(row?.nextNumber).toBe(103)
    })
  })

  it('a genuine forward year rotation restarts the per-year counter at 1', async () => {
    await withRollback(async (tx) => {
      await tx
        .update(numberSequences)
        .set({
          prefix: 'INV-',
          yearSegment: true,
          currentYear: 2026,
          nextNumber: 57,
          padding: 5,
        })
        .where(eq(numberSequences.sequenceKey, 'invoice'))

      const last2026 = await nextNumber(tx, 'invoice', new Date('2026-12-31'))
      expect(last2026).toBe('INV-2026-00057')

      // First document of 2027 — a real forward rotation, counter restarts.
      const first2027 = await nextNumber(tx, 'invoice', new Date('2027-01-02'))
      expect(first2027).toBe('INV-2027-00001')

      const row = await tx.query.numberSequences.findFirst({
        where: eq(numberSequences.sequenceKey, 'invoice'),
      })
      expect(row?.currentYear).toBe(2027)
      expect(row?.nextNumber).toBe(2)
    })
  })
})
