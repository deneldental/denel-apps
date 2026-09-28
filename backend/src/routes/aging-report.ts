/**
 * Aging Report — Phase 7.1
 * AR aging buckets per patient: 0-30, 31-60, 61-90, 90+ days outstanding.
 */

import { inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { invoices, patients } from '../db/schema'
import { assignBucket, daysOverdue } from '../lib/aging'
import { logAnalyticsAccess } from '../lib/analytics-audit'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const agingReportApp = new Hono<HonoEnv>()

type PatientAging = {
  patientId: string
  patientName: string
  patientIdStr: string | null
  current: number // 0-30
  bucket30: number // 31-60
  bucket60: number // 61-90
  bucket90: number // 90+
  total: number
  oldestOverdueDate: string | null
}

agingReportApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      user.id,
      MODULES.FINANCIAL_RECORDS as string,
      ACTIONS.READ as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  await logAnalyticsAccess(c, 'aging-report')

  const db = getDb(process.env.DATABASE_URL!)

  // Fetch unpaid/partial invoices
  const outstanding = await db
    .select()
    .from(invoices)
    .where(inArray(invoices.status, ['pending', 'partial', 'overdue']))

  // Build patient map
  const perPatient = new Map<string, PatientAging>()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  for (const inv of outstanding) {
    // Patient aging report — skip specialist-billed invoices (Phase 3
    // external lab cases). They have their own AR ledger via party_type
    // tagging and shouldn't pollute patient-debtor reports.
    if (!inv.patientId) continue

    const due = inv.dueDate ? new Date(inv.dueDate) : null
    const balance = (inv.amount ?? 0) - (inv.paidAmount ?? 0)
    if (balance <= 0) continue

    let row = perPatient.get(inv.patientId)
    if (!row) {
      row = {
        patientId: inv.patientId,
        patientName: '',
        patientIdStr: null,
        current: 0,
        bucket30: 0,
        bucket60: 0,
        bucket90: 0,
        total: 0,
        oldestOverdueDate: null,
      }
      perPatient.set(inv.patientId, row)
    }

    // Assign to the correct aging bucket via the pure helper (unit-tested in lib/aging.ts)
    const bucket = assignBucket(due, today)
    row[bucket] += balance
    row.total += balance

    if (due && (row.oldestOverdueDate == null || due.toISOString() < row.oldestOverdueDate)) {
      row.oldestOverdueDate = due.toISOString()
    }
  }

  // `daysOverdue` intentionally re-exported here for future drill-down endpoints
  void daysOverdue

  // Enrich with patient names in one batch query
  const ids = Array.from(perPatient.keys())
  if (ids.length > 0) {
    const patientRows = await db.select().from(patients).where(inArray(patients.id, ids))
    for (const p of patientRows) {
      const row = perPatient.get(p.id)
      if (row) {
        row.patientName = p.name
        row.patientIdStr = p.patientId ?? null
      }
    }
  }

  const data = Array.from(perPatient.values()).sort((a, b) => b.total - a.total)

  // Summary totals
  const summary = data.reduce(
    (acc, row) => {
      acc.current += row.current
      acc.bucket30 += row.bucket30
      acc.bucket60 += row.bucket60
      acc.bucket90 += row.bucket90
      acc.total += row.total
      return acc
    },
    { current: 0, bucket30: 0, bucket60: 0, bucket90: 0, total: 0 }
  )

  return c.json({
    success: true,
    data: { rows: data, summary, patientCount: data.length },
  })
})

export { agingReportApp }
