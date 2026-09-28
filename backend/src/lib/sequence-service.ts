/**
 * sequence-service.ts
 *
 * Allocates gap-free document numbers (invoice, payment, bill, journal entry,
 * etc.) by row-locking the matching `number_sequences` row inside the caller's
 * transaction. The transaction owns the lock until commit, so concurrent
 * allocations are serialized.
 *
 * The number is only finalised once the caller's transaction commits. If the
 * caller rolls back, the locked row's `next_number` is rolled back too — so
 * cancelled drafts don't leave gaps.
 */

import { eq, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { numberSequences } from '../db/schema'

export type SequenceKey =
  | 'invoice'
  | 'payment'
  | 'bill'
  | 'credit_note'
  | 'journal_entry'
  | 'payout'
  | 'plan'

/**
 * Allocate the next number for `key`. Must be called inside a transaction
 * (`db.transaction(async (tx) => ...)`).
 *
 * Implementation: SELECT ... FOR UPDATE locks the row; we read, format, then
 * UPDATE the row to bump the counter. Postgres holds the lock until commit.
 */
export async function nextNumber(
  tx: DB,
  key: SequenceKey,
  atDate: Date = new Date()
): Promise<string> {
  const docYear = atDate.getFullYear()

  // Acquire the row lock. `FOR UPDATE` blocks concurrent allocations of the
  // same key but doesn't touch any other rows.
  const rows = await tx.execute(sql`
    SELECT id, prefix, year_segment, current_year, next_number, padding
    FROM number_sequences
    WHERE sequence_key = ${key}
    FOR UPDATE
  `)

  const row =
    (rows as unknown as { rows: SequenceRow[] }).rows?.[0] ??
    (Array.isArray(rows) ? (rows as unknown as SequenceRow[])[0] : undefined)
  if (!row) {
    throw new Error(`sequence "${key}" not seeded — add a row in number_sequences`)
  }

  // Year rotation (H12): `current_year` only ever moves FORWARD. The counter
  // restarts at 1 only on a genuine forward rotation (a document dated in a
  // later year than we've seen). A *backdated* document (dated in an earlier
  // year than `current_year`) must NOT reset the counter and must NOT drag
  // `current_year` backward — doing so would re-issue numbers already handed
  // out and let a future allocation collide with them. The backdated document
  // still gets its own year in the prefix; its sequence number simply comes
  // from the shared monotonic counter.
  let counter = row.next_number
  let newCurrentYear = row.current_year
  if (row.year_segment) {
    const seqYear = row.current_year ?? docYear
    if (docYear > seqYear) {
      // Genuine forward rotation — restart the per-year counter.
      counter = 1
      newCurrentYear = docYear
    } else {
      // Same year, or a backdated document: keep the monotonic counter and
      // never move `current_year` backward.
      newCurrentYear = seqYear
    }
  }

  const padded = String(counter).padStart(row.padding, '0')
  const yearPart = row.year_segment ? `${docYear}-` : ''
  const formatted = `${row.prefix}${yearPart}${padded}`

  await tx
    .update(numberSequences)
    .set({
      nextNumber: counter + 1,
      currentYear: row.year_segment ? newCurrentYear : row.current_year,
      updatedAt: new Date(),
    })
    .where(eq(numberSequences.id, row.id))

  return formatted
}

type SequenceRow = {
  id: string
  prefix: string
  year_segment: boolean
  current_year: number | null
  next_number: number
  padding: number
}
