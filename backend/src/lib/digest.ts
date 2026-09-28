/**
 * Daily-digest framework — admin-v1 §10.1.
 *
 * Every module contributes a summary block for a given day; the daily report
 * freezes these blocks at submission, and a live endpoint can compute them for
 * any date. Modules register a provider via `registerDigestProvider`; Phase 5
 * adds the rest (labs, x-ray, store, compliance, consents, CRM, HR, training, …).
 *
 * This is the system-wide daily digest — distinct from the Audit forensic log.
 */

import { and, count, eq, gt, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm'
import type { getDb } from '../db'
import { attendanceExceptions } from '../db/schema/attendance'
import { expenses, payments, sales } from '../db/schema/billing'
import {
  appointments,
  orthoConsentForms,
  recarePlans,
  signedConsentForms,
} from '../db/schema/clinical'
import { smsMessages } from '../db/schema/comms'
import { inventoryBatches, items, stockMovements } from '../db/schema/inventory'
import { auditLogs } from '../db/schema/operations'
import { patients } from '../db/schema/patients'
import {
  complianceDocuments,
  staff,
  staffRequests,
  staffTrainingProgress,
  trainingMaterials,
} from '../db/schema/staff'
import { COMMS_EXPENSE_CATEGORY } from './comms-cost'
import { getLabDailySummary } from './lab-summary'
import { logError } from './logger'
import { getXrayDailySummary } from './xray-charge-service'

/** Integer CENTS in — digest figures are SUMs over money columns. */
function ghsFromCents(cents: number): string {
  return `GHS ${(cents / 100).toFixed(2)}`
}

type Db = ReturnType<typeof getDb>

export interface ModuleSummaryMetric {
  label: string
  value: string | number
}

export interface ModuleSummary {
  module: string
  title: string
  metrics: ModuleSummaryMetric[]
}

type DigestProvider = (db: Db, dayStart: Date, dayEnd: Date) => Promise<ModuleSummary | null>

const providers = new Map<string, DigestProvider>()

/** Register a module's daily-digest provider (admin-v1 §10.1). Idempotent per module key. */
export function registerDigestProvider(module: string, fn: DigestProvider): void {
  providers.set(module, fn)
}

/** Run every registered provider for the given calendar date, in registration order. */
export async function buildModuleSummaries(db: Db, date: Date): Promise<ModuleSummary[]> {
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(date)
  dayEnd.setHours(23, 59, 59, 999)

  const out: ModuleSummary[] = []
  for (const [module, fn] of providers) {
    try {
      const block = await fn(db, dayStart, dayEnd)
      if (block) out.push(block)
    } catch (err) {
      logError(err, { context: `[digest] provider '${module}' failed` })
    }
  }
  return out
}

// ── Built-in providers ─────────────────────────────────────────────────────────

// Appointment status carries both 'no_show' and legacy 'no-show'; normalise.
const norm = (s: string) => s.replace(/-/g, '_')

registerDigestProvider('appointments', async (db, start, end) => {
  const rows = await db
    .select({ status: appointments.status, n: count() })
    .from(appointments)
    .where(and(gte(appointments.date, start), lte(appointments.date, end)))
    .groupBy(appointments.status)
  const total = rows.reduce((s, r) => s + Number(r.n), 0)
  if (total === 0) return null
  const by = (k: string) =>
    rows.filter((r) => norm(r.status) === k).reduce((a, r) => a + Number(r.n), 0)
  return {
    module: 'appointments',
    title: 'Appointments',
    metrics: [
      { label: 'Total', value: total },
      { label: 'Completed', value: by('completed') },
      { label: 'Cancelled', value: by('cancelled') },
      { label: 'No-show', value: by('no_show') },
    ],
  }
})

registerDigestProvider('payments', async (db, start, end) => {
  const [row] = await db
    .select({ n: count(), total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
    .from(payments)
    .where(
      and(
        gte(payments.createdAt, start),
        lte(payments.createdAt, end),
        eq(payments.direction, 'incoming')
      )
    )
  const n = Number(row?.n ?? 0)
  if (n === 0) return null
  return {
    module: 'payments',
    title: 'Payments received',
    metrics: [
      { label: 'Count', value: n },
      { label: 'Total', value: ghsFromCents(Number(row?.total ?? 0)) },
    ],
  }
})

// Payment reversals — reception can reverse a mis-keyed payment
// (`payments:update`), so every reversal is surfaced on the day's report as the
// standing control on that permission. Sourced from `payments.reversedAt`, and
// the per-reversal reason lives in the audit log.
registerDigestProvider('payment-reversals', async (db, start, end) => {
  const [row] = await db
    .select({ n: count(), total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
    .from(payments)
    .where(and(gte(payments.reversedAt, start), lte(payments.reversedAt, end)))
  const n = Number(row?.n ?? 0)
  if (n === 0) return null
  return {
    module: 'payment-reversals',
    title: 'Payment reversals',
    metrics: [
      { label: 'Reversed', value: n },
      { label: 'Value', value: ghsFromCents(Number(row?.total ?? 0)) },
    ],
  }
})

// Inventory record changes — reception holds edit + delete on inventory/products,
// so item edits and deletions are reported daily. Read from the audit log rather
// than the items table because a deleted row leaves nothing behind to count.
registerDigestProvider('inventory-changes', async (db, start, end) => {
  const rows = await db
    .select({ action: auditLogs.action, module: auditLogs.module, n: count() })
    .from(auditLogs)
    .where(
      and(
        inArray(auditLogs.module, ['inventory', 'products', 'items']),
        inArray(auditLogs.action, ['update', 'delete', 'create']),
        gte(auditLogs.createdAt, start),
        lte(auditLogs.createdAt, end)
      )
    )
    .groupBy(auditLogs.action, auditLogs.module)
  const by = (a: string) => rows.filter((r) => r.action === a).reduce((s, r) => s + Number(r.n), 0)
  const created = by('create')
  const edited = by('update')
  const deleted = by('delete')
  if (created === 0 && edited === 0 && deleted === 0) return null
  return {
    module: 'inventory-changes',
    title: 'Inventory changes',
    metrics: [
      { label: 'Items added', value: created },
      { label: 'Items edited', value: edited },
      { label: 'Items deleted', value: deleted },
    ],
  }
})

registerDigestProvider('inventory', async (db) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const in30Days = new Date(today)
  in30Days.setDate(in30Days.getDate() + 30)

  // 1. Low-stock count — consumable items at or below reorder level.
  const [lowRow] = await db
    .select({ n: count() })
    .from(items)
    .where(
      and(
        eq(items.consumable, true),
        sql`${items.stockQuantity} <= coalesce(${items.reorderLevel}, 10)`
      )
    )

  // 2. Restocked today — receipt movements created today.
  const [restockedRow] = await db
    .select({ n: count() })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.type, 'receipt'),
        gte(stockMovements.createdAt, today),
        lt(stockMovements.createdAt, tomorrow)
      )
    )

  // 3. Expiring soon — batches with expiryDate within the next 30 days, qty > 0.
  const [expiringRow] = await db
    .select({ n: count() })
    .from(inventoryBatches)
    .where(
      and(
        gt(inventoryBatches.qtyRemaining, 0),
        lte(inventoryBatches.expiryDate, in30Days),
        gte(inventoryBatches.expiryDate, today)
      )
    )

  return {
    module: 'inventory',
    title: 'Inventory',
    metrics: [
      { label: 'Low-stock items', value: Number(lowRow?.n ?? 0) },
      { label: 'Restocked today', value: Number(restockedRow?.n ?? 0) },
      { label: 'Expiring soon (30d)', value: Number(expiringRow?.n ?? 0) },
    ],
  }
})

// §10.1 — additional Phase-5 providers.

// §8.6 — Labs mini-report: cases-by-status + patient lab revenue + lab_work /
// lab-inventory expenses. Delegates to the aggregator (lab-summary.ts).
registerDigestProvider('labs', (db, start) => getLabDailySummary(db, start))

// §9.7 — X-ray mini-report: internal/external split + catalog revenue + tax +
// X-ray expense spend. Delegates to the aggregator (xray-charge-service.ts).
registerDigestProvider('xrays', (db, start) => getXrayDailySummary(db, start))

registerDigestProvider('store', async (db, start, end) => {
  const [row] = await db
    .select({ n: count(), total: sql<string>`coalesce(sum(${sales.totalAmount}), 0)` })
    .from(sales)
    .where(and(eq(sales.status, 'submitted'), gte(sales.saleDate, start), lte(sales.saleDate, end)))
  const n = Number(row?.n ?? 0)
  if (n === 0) return null
  return {
    module: 'store',
    title: 'Store sales',
    metrics: [
      { label: 'Sales', value: n },
      { label: 'Total', value: ghsFromCents(Number(row?.total ?? 0)) },
    ],
  }
})

registerDigestProvider('new-patients', async (db, start, end) => {
  const [row] = await db
    .select({ n: count() })
    .from(patients)
    .where(and(gte(patients.createdAt, start), lte(patients.createdAt, end)))
  const n = Number(row?.n ?? 0)
  if (n === 0) return null
  return {
    module: 'new-patients',
    title: 'New patients',
    metrics: [{ label: 'Registered', value: n }],
  }
})

// §13.6 — CRM / outreach: messages sent today, failed SMS, recare due (as of
// day-end), and the §13.5 send cost booked today (the Communications expense).
registerDigestProvider('crm', async (db, start, end) => {
  const [sms] = await db
    .select({
      sent: sql<string>`count(*)`,
      failed: sql<string>`count(*) filter (where ${smsMessages.status} like 'failed%')`,
    })
    .from(smsMessages)
    .where(and(gte(smsMessages.sentAt, start), lte(smsMessages.sentAt, end)))
  // Recare due = active, still-pending plans whose alert date has arrived by end of the day.
  const [recare] = await db
    .select({ n: count() })
    .from(recarePlans)
    .where(
      and(
        eq(recarePlans.isActive, true),
        eq(recarePlans.status, 'pending'),
        lte(recarePlans.nextAlertDate, end)
      )
    )
  // §13.5 — today's send cost: the Communications expense-category spend posted
  // today (matches the category recordCommsCost books to).
  const [costRow] = await db
    .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
    .from(expenses)
    .where(
      and(
        eq(expenses.status, 'paid'),
        gte(expenses.date, start),
        lte(expenses.date, end),
        sql`lower(trim(${expenses.category})) = lower(${COMMS_EXPENSE_CATEGORY})`
      )
    )
  const sent = Number(sms?.sent ?? 0)
  const failed = Number(sms?.failed ?? 0)
  const due = Number(recare?.n ?? 0)
  const cost = Number(costRow?.total ?? 0)
  if (sent === 0 && failed === 0 && due === 0 && cost === 0) return null
  return {
    module: 'crm',
    title: 'CRM / outreach',
    metrics: [
      { label: 'Messages sent', value: sent },
      { label: 'Failed SMS', value: failed },
      { label: 'Recare due', value: due },
      { label: 'Send cost', value: ghsFromCents(cost) },
    ],
  }
})

// §14.5 — HR: on leave today, attendance exceptions, pending requests, staff birthdays.
registerDigestProvider('hr', async (db, start, end) => {
  const pad = (n: number) => `${n}`.padStart(2, '0')
  const ymd = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
  // Approved leave whose [start,end] range covers the digest day.
  const [leave] = await db
    .select({ n: count() })
    .from(staffRequests)
    .where(
      and(
        eq(staffRequests.requestType, 'leave'),
        eq(staffRequests.status, 'approved'),
        lte(staffRequests.startDate, end),
        gte(staffRequests.endDate, start)
      )
    )
  const [exc] = await db
    .select({ n: count() })
    .from(attendanceExceptions)
    .where(eq(attendanceExceptions.date, ymd))
  const [pending] = await db
    .select({ n: count() })
    .from(staffRequests)
    .where(eq(staffRequests.status, 'pending'))
  const [bdays] = await db
    .select({ n: count() })
    .from(staff)
    .where(
      and(
        eq(staff.birthMonth, start.getMonth() + 1),
        eq(staff.birthDay, start.getDate()),
        eq(staff.status, 'active'),
        isNull(staff.deletedAt)
      )
    )
  const onLeave = Number(leave?.n ?? 0)
  const exceptions = Number(exc?.n ?? 0)
  const pend = Number(pending?.n ?? 0)
  const birthdays = Number(bdays?.n ?? 0)
  if (onLeave === 0 && exceptions === 0 && pend === 0 && birthdays === 0) return null
  return {
    module: 'hr',
    title: 'HR / staff',
    metrics: [
      { label: 'On leave', value: onLeave },
      { label: 'Attendance exceptions', value: exceptions },
      { label: 'Pending requests', value: pend },
      { label: 'Birthdays', value: birthdays },
    ],
  }
})

// §15.3 — Training: completions today + mandatory training due/overdue (as of day-end).
registerDigestProvider('training', async (db, start, end) => {
  const [comp] = await db
    .select({ n: count() })
    .from(staffTrainingProgress)
    .where(
      and(
        eq(staffTrainingProgress.status, 'completed'),
        gte(staffTrainingProgress.completedAt, start),
        lte(staffTrainingProgress.completedAt, end)
      )
    )
  const [due] = await db
    .select({ n: count() })
    .from(trainingMaterials)
    .where(
      and(
        eq(trainingMaterials.isMandatory, true),
        eq(trainingMaterials.published, true),
        lte(trainingMaterials.deadline, end)
      )
    )
  const completed = Number(comp?.n ?? 0)
  const overdue = Number(due?.n ?? 0)
  if (completed === 0 && overdue === 0) return null
  return {
    module: 'training',
    title: 'Training',
    metrics: [
      { label: 'Completed today', value: completed },
      { label: 'Due / overdue', value: overdue },
    ],
  }
})

// §17.3 — Compliance: documents added today, expiring within 30 days, already expired.
registerDigestProvider('compliance', async (db, start, end) => {
  const in30 = new Date(start)
  in30.setDate(in30.getDate() + 30)
  const [added] = await db
    .select({ n: count() })
    .from(complianceDocuments)
    .where(and(gte(complianceDocuments.createdAt, start), lte(complianceDocuments.createdAt, end)))
  const [soon] = await db
    .select({ n: count() })
    .from(complianceDocuments)
    .where(
      and(gte(complianceDocuments.dateExpired, start), lte(complianceDocuments.dateExpired, in30))
    )
  const [expired] = await db
    .select({ n: count() })
    .from(complianceDocuments)
    .where(lt(complianceDocuments.dateExpired, start))
  const addedToday = Number(added?.n ?? 0)
  const expiringSoon = Number(soon?.n ?? 0)
  const alreadyExpired = Number(expired?.n ?? 0)
  if (addedToday === 0 && expiringSoon === 0 && alreadyExpired === 0) return null
  return {
    module: 'compliance',
    title: 'Compliance',
    metrics: [
      { label: 'Added today', value: addedToday },
      { label: 'Expiring soon (30d)', value: expiringSoon },
      { label: 'Expired', value: alreadyExpired },
    ],
  }
})

// §18.3 — Consents: signed today + outstanding unsigned ortho consents.
registerDigestProvider('consents', async (db, start, end) => {
  const [signed] = await db
    .select({ n: count() })
    .from(signedConsentForms)
    .where(and(gte(signedConsentForms.signedAt, start), lte(signedConsentForms.signedAt, end)))
  const [pendingOrtho] = await db
    .select({ n: count() })
    .from(orthoConsentForms)
    .where(eq(orthoConsentForms.status, 'unsigned'))
  const signedToday = Number(signed?.n ?? 0)
  const unsigned = Number(pendingOrtho?.n ?? 0)
  if (signedToday === 0 && unsigned === 0) return null
  return {
    module: 'consents',
    title: 'Consents',
    metrics: [
      { label: 'Signed today', value: signedToday },
      { label: 'Pending ortho consents', value: unsigned },
    ],
  }
})
