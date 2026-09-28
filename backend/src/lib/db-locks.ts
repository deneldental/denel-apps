/**
 * db-locks.ts — pessimistic row locking for the finance posting paths.
 *
 * Every posting transaction (issue / post / void / reverse / apply-credit /
 * pay-bill) does a read-modify-write on a balance row. Without a lock, two
 * concurrent transactions both read the same starting balance and the second
 * write clobbers the first — the invoice/bill/payment balance silently drifts
 * from the GL (code-report-v1.md C3, H6).
 *
 * These helpers issue `SELECT … FOR UPDATE` so the row is held until the
 * caller's transaction commits. The relational query builder
 * (`tx.query.X.findFirst`) does NOT support `FOR UPDATE`, so a posting path
 * that needs the lock must use these instead of `findFirst`.
 *
 * MUST be called inside a transaction — `FOR UPDATE` outside one is a no-op.
 */

import { eq, inArray } from 'drizzle-orm'
import type { DB } from '../db'
import { bills, invoices, patientWallets, payments } from '../db/schema'

/** `SELECT … FOR UPDATE` a single invoice row. Returns null if not found. */
export async function lockInvoice(
  tx: DB,
  id: string
): Promise<typeof invoices.$inferSelect | null> {
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update').limit(1)
  return row ?? null
}

/**
 * `SELECT … FOR UPDATE` a set of invoice rows in ONE round-trip. Returns a Map
 * keyed by id (ids not found are simply absent). Use when a posting path
 * touches several invoices — it locks every matching row exactly as
 * `lockInvoice` does, without the per-row N+1 (code-report-v1 M7).
 */
export async function lockInvoices(
  tx: DB,
  ids: string[]
): Promise<Map<string, typeof invoices.$inferSelect>> {
  if (ids.length === 0) return new Map()
  const rows = await tx.select().from(invoices).where(inArray(invoices.id, ids)).for('update')
  return new Map(rows.map((r) => [r.id, r]))
}

/** `SELECT … FOR UPDATE` a single bill row. Returns null if not found. */
export async function lockBill(tx: DB, id: string): Promise<typeof bills.$inferSelect | null> {
  const [row] = await tx.select().from(bills).where(eq(bills.id, id)).for('update').limit(1)
  return row ?? null
}

/** `SELECT … FOR UPDATE` a single payment row. Returns null if not found. */
export async function lockPayment(
  tx: DB,
  id: string
): Promise<typeof payments.$inferSelect | null> {
  const [row] = await tx.select().from(payments).where(eq(payments.id, id)).for('update').limit(1)
  return row ?? null
}

/**
 * `SELECT … FOR UPDATE` the patient's wallet row. Returns null if the patient
 * has no wallet yet (no credit has ever been recorded). Callers that need to
 * guarantee a row exists should `getOrCreateWallet` first, then lock.
 */
export async function lockPatientWallet(
  tx: DB,
  patientId: string
): Promise<typeof patientWallets.$inferSelect | null> {
  const [row] = await tx
    .select()
    .from(patientWallets)
    .where(eq(patientWallets.patientId, patientId))
    .for('update')
    .limit(1)
  return row ?? null
}
