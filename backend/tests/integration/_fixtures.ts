/**
 * Shared fixture builders for the finance integration tests.
 *
 * Two flavours:
 *  - The `withRollback`-friendly builders (`makePatient`, `makeDraftInvoice`,
 *    …) just INSERT into the supplied tx handle; the sandbox transaction rolls
 *    everything back, so they never touch the shared dev DB.
 *  - `withCommittedFixtures` is for the few tests that genuinely need two
 *    concurrent transactions to SEE the same rows (the C3 lost-update proof).
 *    It COMMITS its fixtures, runs the test, then deletes exactly what it
 *    created in a `finally` — patient delete cascades invoices/payments/
 *    allocations/wallets; journal entries are tracked and deleted explicitly
 *    because they don't cascade.
 */

import { randomUUID } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import type { DB } from '../../src/db'
import {
  invoiceLines,
  invoices,
  journalEntries,
  journalLines,
  patients,
  specialists,
} from '../../src/db/schema'
import { getTestDb } from './_setup'

/** Any existing staff user id — needed for the many `created_by` FKs. */
export async function anyUserId(tx: DB): Promise<string> {
  const r = await tx.execute<{ id: string }>(sql`SELECT id FROM "user" LIMIT 1`)
  const id = r.rows[0]?.id
  if (!id) throw new Error('integration fixtures need at least one row in "user"')
  return id
}

/** Look up a seeded Chart-of-Accounts account id by code. */
export async function accountIdByCode(tx: DB, code: string): Promise<string> {
  const r = await tx.execute<{ id: string }>(
    sql`SELECT id FROM accounts WHERE code = ${code} LIMIT 1`
  )
  const id = r.rows[0]?.id
  if (!id) throw new Error(`account ${code} is not seeded in the dev DB`)
  return id
}

/** A unique-enough invoice number so parallel test workers never collide. */
export function uniqueDocNumber(prefix: string): string {
  return `${prefix}-IT-${randomUUID().slice(0, 12)}`
}

export async function makePatient(tx: DB, name = 'IT Patient'): Promise<string> {
  const [p] = await tx
    .insert(patients)
    .values({ name, dob: new Date('1990-01-01'), gender: 'other' })
    .returning()
  return p.id
}

export async function makeSpecialist(
  tx: DB,
  opts: { commissionRate?: number; whtRate?: number } = {}
): Promise<string> {
  const [s] = await tx
    .insert(specialists)
    .values({
      name: 'IT Specialist',
      defaultCommissionRate: opts.commissionRate ?? 10,
      withholdingTaxRate: opts.whtRate ?? 0,
    })
    .returning()
  return s.id
}

/**
 * Insert a DRAFT invoice with a single line. Call `issueInvoice` to commit it
 * to the GL. Returns the invoice id and its line id.
 */
export async function makeDraftInvoice(
  tx: DB,
  opts: {
    patientId: string
    userId: string
    amount: number
    revenueAccountId: string
    specialistId?: string
    commissionRate?: number
    deferRevenue?: boolean
  }
): Promise<{ invoiceId: string; invoiceLineId: string; invoiceNumber: string }> {
  const invoiceNumber = uniqueDocNumber('INV')
  const [inv] = await tx
    .insert(invoices)
    .values({
      invoiceNumber,
      patientId: opts.patientId,
      type: 'one_time',
      status: 'draft',
      amount: 0,
      paidAmount: 0,
      createdBy: opts.userId,
    })
    .returning()
  const [line] = await tx
    .insert(invoiceLines)
    .values({
      invoiceId: inv.id,
      lineNumber: 1,
      description: 'IT line',
      quantity: 1,
      unitPrice: opts.amount,
      lineSubtotal: opts.amount,
      lineAfterDiscount: opts.amount,
      lineTotal: opts.amount,
      revenueAccountId: opts.revenueAccountId,
      specialistId: opts.specialistId ?? null,
      commissionRate: opts.commissionRate ?? null,
      deferRevenue: opts.deferRevenue ?? false,
    })
    .returning()
  return { invoiceId: inv.id, invoiceLineId: line.id, invoiceNumber }
}

/**
 * Defensive sweep: delete any `IT %` patient (and the journal entries traceable
 * to its documents) left behind by a previous *aborted* run — a vitest timeout
 * can kill a `withCommittedFixtures` test before its `finally` cleanup runs.
 * Call from `beforeAll` in any committed-fixture test file so each run starts
 * clean. Safe to run repeatedly; only touches `IT %`-named patients.
 */
export async function sweepLeakedFixtures(): Promise<void> {
  const db = getTestDb()
  const leaked = await db.execute<{ id: string }>(
    sql`SELECT id FROM patients WHERE name LIKE 'IT %'`
  )
  for (const { id } of leaked.rows) {
    const docs = await db.execute<{ id: string }>(
      sql`SELECT id FROM invoices WHERE "patientId" = ${id}
          UNION
          SELECT id FROM payments WHERE "patientId" = ${id} OR party_id = ${id}`
    )
    const docIds = docs.rows.map((d) => d.id)
    if (docIds.length > 0) {
      const entries = await db.execute<{ id: string }>(
        sql`SELECT id FROM journal_entries WHERE source_doc_id IN (${sql.join(docIds, sql`, `)})`
      )
      const ids = entries.rows.map((e) => e.id)
      if (ids.length > 0) {
        await db.delete(journalLines).where(inArray(journalLines.entryId, ids))
        await db
          .update(journalEntries)
          .set({ reversesEntryId: null })
          .where(inArray(journalEntries.reversesEntryId, ids))
        await db.delete(journalEntries).where(inArray(journalEntries.id, ids))
      }
    }
    await db.delete(patients).where(eq(patients.id, id))
  }
}

/**
 * Run `fn` against the shared dev DB with COMMITTED fixtures so that genuinely
 * concurrent transactions can see them. `fn` receives the live `db` plus a
 * `track()` callback — register every journal-entry id created during the test
 * so it can be cleaned up (journal entries don't cascade from the patient).
 *
 * Cleanup always runs, even if `fn` throws.
 */
export async function withCommittedFixtures<T>(
  setup: (db: DB) => Promise<{ patientId: string }>,
  fn: (ctx: { db: DB; patientId: string; trackEntry: (id: string) => void }) => Promise<T>
): Promise<T> {
  const db = getTestDb()
  const entryIds = new Set<string>()
  const { patientId } = await setup(db)
  try {
    return await fn({ db, patientId, trackEntry: (id) => entryIds.add(id) })
  } finally {
    // Journal entries first (no cascade), then the patient (cascades the rest).
    if (entryIds.size > 0) {
      const ids = [...entryIds]
      await db.delete(journalLines).where(inArray(journalLines.entryId, ids))
      // A reversal entry references its original via reverses_entry_id — null
      // those refs out before deleting the tracked entries themselves.
      await db
        .update(journalEntries)
        .set({ reversesEntryId: null })
        .where(inArray(journalEntries.reversesEntryId, ids))
      await db.delete(journalEntries).where(inArray(journalEntries.id, ids))
    }
    await db.delete(patients).where(eq(patients.id, patientId))
  }
}
