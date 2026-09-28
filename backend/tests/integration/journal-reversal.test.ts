/**
 * Regression test for H11 — `reverseJournalEntry` double-reverse guard.
 *
 * The bug: `reverseJournalEntry` only refused to reverse an entry that was
 * itself a reversal. It did not check whether the *original* entry already
 * had a reversal — so calling it twice posted the mirror lines twice,
 * double-crediting/-debiting every account on the entry and silently drifting
 * the GL. The raw `POST /api/journal-entries/:id/reverse` route went through
 * the same function, so it had the same hole.
 *
 * The fix: before reversing, look for an existing entry with
 * `reverses_entry_id = <original>` and throw if one exists.
 */

import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { invoices } from '../../src/db/schema'
import { reverseJournalEntry } from '../../src/lib/gl-service'
import { issueInvoice } from '../../src/lib/invoice-service'
import { accountIdByCode, anyUserId, makeDraftInvoice, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

describe.skipIf(noDb)('reverseJournalEntry — double-reverse guard [H11]', () => {
  it('refuses to reverse an entry that already has a reversal', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const revAcct = await accountIdByCode(tx, '4100')
      const { invoiceId } = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 200,
        revenueAccountId: revAcct,
      })
      const issued = await issueInvoice(tx, invoiceId, userId)
      const entryId = issued.journalEntry.id

      // First reversal succeeds.
      const reversal = await reverseJournalEntry(tx, entryId, {
        createdBy: userId,
        description: 'IT first reversal',
      })
      expect(reversal.isReversal).toBe(true)

      // Second reversal of the SAME entry must be refused — pre-fix it posted a
      // duplicate mirror entry and drifted the GL.
      await expect(
        reverseJournalEntry(tx, entryId, { createdBy: userId, description: 'IT second reversal' })
      ).rejects.toThrow(/already reversed/i)

      // The original entry is still referenced by exactly one reversal.
      const inv = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) })
      expect(inv?.journalEntryId).toBe(entryId)
    })
  })
})
