/**
 * Deletion guards for the price catalog — services, application types (scopes)
 * and tooth classes.
 *
 * Rule: a catalog row may only be retired while it carries NO billing history.
 * "Billing history" means it appears on an invoice line belonging to an invoice
 * that has actually been issued — anything except a `draft` (never issued) or a
 * `void` (issued then reversed). A draft estimate that was abandoned must not
 * pin the catalog forever.
 *
 * Why this is a superset of "linked to a payment": a line on an `issued` invoice
 * is money owed even before it is paid, and voiding a paid invoice leaves the
 * payment record behind. Keying on "has a payment row" alone would let an unpaid
 * receivable be deleted out from under the ledger.
 *
 * `invoice_lines.service_id` / `.tooth_class_id` are SOFT foreign keys (no
 * constraint, by design), so Postgres will not stop a delete on its own — these
 * checks are the only thing standing between a retire and an orphaned line.
 */

import { sql } from 'drizzle-orm'
import type { getDb } from '../db'

/** Invoice states that represent real billing. `draft` and `void` do not. */
const BILLED_STATUSES = ['issued', 'partially_paid', 'paid', 'overdue'] as const

export interface DeletionCheck {
  /** True when the row is safe to retire. */
  deletable: boolean
  /** Invoice lines blocking the delete. */
  billedLineCount: number
  /** Human-readable reason, present only when `deletable` is false. */
  reason?: string
}

function block(count: number, what: string): DeletionCheck {
  return {
    deletable: false,
    billedLineCount: count,
    reason:
      `Cannot delete: ${what} on ${count} billed invoice line${count === 1 ? '' : 's'}. ` +
      `Deactivate it instead — that hides it from new work while keeping the history intact.`,
  }
}

/** A service is blocked once it has been billed on any non-draft, non-void invoice. */
export async function checkServiceDeletable(
  db: ReturnType<typeof getDb>,
  serviceId: string
): Promise<DeletionCheck> {
  const res = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    WHERE il.service_id = ${serviceId}
      AND i.status = ANY(${sql.raw(`ARRAY['${BILLED_STATUSES.join("','")}']`)})
  `)
  const count = Number((res.rows[0] as { count?: number } | undefined)?.count ?? 0)
  return count > 0 ? block(count, 'this service appears') : { deletable: true, billedLineCount: 0 }
}

/** A tooth class is blocked once a billed line was priced by it. */
export async function checkToothClassDeletable(
  db: ReturnType<typeof getDb>,
  toothClassId: string
): Promise<DeletionCheck> {
  const res = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    WHERE il.tooth_class_id = ${toothClassId}
      AND i.status = ANY(${sql.raw(`ARRAY['${BILLED_STATUSES.join("','")}']`)})
  `)
  const count = Number((res.rows[0] as { count?: number } | undefined)?.count ?? 0)
  return count > 0
    ? block(count, 'this tooth class priced')
    : { deletable: true, billedLineCount: 0 }
}

/**
 * An application type has no direct line reference — its money link is indirect,
 * through the services that bill against it. Blocked when any such service has
 * been billed.
 */
export async function checkApplicationScopeDeletable(
  db: ReturnType<typeof getDb>,
  scopeId: string
): Promise<DeletionCheck> {
  const res = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    JOIN services s ON s.id = il.service_id
    WHERE s."scopeId" = ${scopeId}
      AND i.status = ANY(${sql.raw(`ARRAY['${BILLED_STATUSES.join("','")}']`)})
  `)
  const count = Number((res.rows[0] as { count?: number } | undefined)?.count ?? 0)
  return count > 0
    ? block(count, 'services using this application type appear')
    : { deletable: true, billedLineCount: 0 }
}
