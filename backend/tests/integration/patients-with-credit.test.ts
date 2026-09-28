/**
 * Regression test for getPatientsWithCredit — backs `GET /api/payments/patients-with-credit`.
 *
 * Bug: the route was never added to payments.ts (the H19 remediation shipped
 * the frontend caller but not the backend route). `GET /patients-with-credit`
 * fell through to the `/:id` catch-all, which queried the UUID `payments.id`
 * column with the literal string "patients-with-credit" → Postgres error → the
 * handler swallowed it and returned 500. The /refunds page showed
 * "Failed to fetch payment".
 */

import { describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { getPatientsWithCredit } from '../../src/lib/payment-service'
import { noDb, withRollback } from './_setup'

describe.skipIf(noDb)('getPatientsWithCredit', () => {
  it('returns only patients with a positive deposit balance, with a numeric balance', async () => {
    const result = await withRollback(async (tx) => {
      const [withCredit] = await tx
        .insert(schema.patients)
        .values({
          name: 'Credit Holder',
          patientId: '#TEST-CREDIT',
          dob: new Date('1990-01-01'),
          gender: 'other',
        })
        .returning()
      await tx
        .insert(schema.patientBalances)
        .values({ patientId: withCredit.id, depositBalance: 25050, arBalance: 0 })

      const [noCredit] = await tx
        .insert(schema.patients)
        .values({
          name: 'No Credit',
          patientId: '#TEST-NOCREDIT',
          dob: new Date('1990-01-01'),
          gender: 'other',
        })
        .returning()
      await tx
        .insert(schema.patientBalances)
        .values({ patientId: noCredit.id, depositBalance: 0, arBalance: 0 })

      return getPatientsWithCredit(tx)
    })

    const holder = result.find((p) => p.name === 'Credit Holder')
    expect(holder).toBeDefined()
    expect(holder?.patientCode).toBe('#TEST-CREDIT')
    // Cents since migration 0209 — 25050 = GHS 250.50.
    expect(holder?.depositBalance).toBe(25050)
    expect(typeof holder?.depositBalance).toBe('number')

    // A zero deposit balance must be excluded.
    expect(result.some((p) => p.name === 'No Credit')).toBe(false)
  })
})
