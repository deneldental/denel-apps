/**
 * Regression tests for R3b — finance invariants enforced in the DB itself
 * (migration 0042_finance_constraints).
 *
 *  - C9: a journal entry whose lines don't balance must be rejected. The
 *    constraint trigger is DEFERRABLE INITIALLY DEFERRED (gl-service inserts
 *    the header then the lines, transiently unbalanced) — the test forces the
 *    check with `SET CONSTRAINTS ALL IMMEDIATE`.
 *  - C10: payment allocations may never exceed the payment amount (also a
 *    deferred constraint trigger).
 *  - H15 / M16: CHECK constraints on invoice status and the
 *    allocated+unallocated=amount split (plain CHECKs — immediate).
 *
 * All run inside `withRollback`; `SET CONSTRAINTS ALL IMMEDIATE` makes the
 * deferred triggers fire before the sandbox rolls back. We assert only that
 * the DB *rejects* the write — pre-0042 every one of these inserts succeeded
 * (that is the "reproduced red?" gate); the wrapped driver error message is
 * not stable enough to regex against.
 */

import { sql } from 'drizzle-orm'
import { describe, it } from 'vitest'
import {
  invoices,
  journalEntries,
  journalLines,
  paymentAllocations,
  payments,
} from '../../src/db/schema'
import { accountIdByCode, anyUserId, makePatient, uniqueDocNumber } from './_fixtures'
import { expectRejection, noDb } from './_setup'

describe.skipIf(noDb)('finance DB constraints [C9/C10/H15]', () => {
  it('C9 — an unbalanced journal entry is rejected by the DB', async () => {
    await expectRejection(async (tx) => {
      const userId = await anyUserId(tx)
      const arId = await accountIdByCode(tx, '1200')
      const revId = await accountIdByCode(tx, '4100')
      const period = await tx.execute<{ id: string }>(
        sql`SELECT id FROM accounting_periods WHERE status = 'open' LIMIT 1`
      )
      const [entry] = await tx
        .insert(journalEntries)
        .values({
          entryNumber: uniqueDocNumber('JE'),
          entryDate: '2026-05-14',
          periodId: period.rows[0].id,
          sourceDocType: 'manual',
          createdBy: userId,
        })
        .returning()
      // 100 debit vs 60 credit — does not balance.
      await tx
        .insert(journalLines)
        .values({ entryId: entry.id, lineNumber: 1, accountId: arId, debit: 100, credit: 0 })
      await tx
        .insert(journalLines)
        .values({ entryId: entry.id, lineNumber: 2, accountId: revId, debit: 0, credit: 60 })
      // Force the deferred balance trigger to fire now.
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)
    })
  })

  it('C10 — payment allocations exceeding the payment amount are rejected', async () => {
    await expectRejection(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const [payment] = await tx
        .insert(payments)
        .values({
          patientId,
          amount: 100,
          allocatedAmount: 100,
          unallocatedAmount: 0,
          method: 'cash',
          status: 'posted',
          partyId: patientId,
        })
        .returning()
      // Two allocations summing to 150 against a 100 payment.
      await tx.insert(paymentAllocations).values({
        paymentId: payment.id,
        targetType: 'invoice',
        targetId: patientId, // any uuid — the trigger only sums amounts
        amount: 100,
        allocatedBy: userId,
      })
      await tx.insert(paymentAllocations).values({
        paymentId: payment.id,
        targetType: 'bill',
        targetId: patientId,
        amount: 50,
        allocatedBy: userId,
      })
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)
    })
  })

  it('H15 — an invalid invoice status is rejected by the CHECK constraint', async () => {
    await expectRejection(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      await tx.insert(invoices).values({
        invoiceNumber: uniqueDocNumber('INV'),
        patientId,
        type: 'one_time',
        status: 'bogus_status', // not in the CHECK set
        amount: 0,
        paidAmount: 0,
        createdBy: userId,
      })
    })
  })

  it('H15 — a payment whose allocated+unallocated != amount is rejected', async () => {
    await expectRejection(async (tx) => {
      const patientId = await makePatient(tx)
      await tx.insert(payments).values({
        patientId,
        amount: 200,
        allocatedAmount: 50,
        unallocatedAmount: 50, // 50 + 50 != 200
        method: 'cash',
        status: 'draft',
        partyId: patientId,
      })
    })
  })
})
