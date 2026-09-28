import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { expenses, medicalRecords, patients, payments } from '../db/schema'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const syncPreviewApp = new Hono<HonoEnv>()

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // ±7 days

/**
 * Build the overall date-range window for a list of records, so we can fetch
 * payments + expenses in a single batched query instead of one query per record.
 */
function overallWindow(dates: Date[]): { min: Date; max: Date } | null {
  if (dates.length === 0) return null
  const ts = dates.map((d) => d.getTime())
  const minTs = Math.min(...ts)
  const maxTs = Math.max(...ts)
  return {
    min: new Date(minTs - WINDOW_MS),
    max: new Date(maxTs + WINDOW_MS),
  }
}

syncPreviewApp.get('/medical-records', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    // 1. Fetch all medical records joined with patients — single query
    const records = await db
      .select({
        id: medicalRecords.id,
        patientId: medicalRecords.patientId,
        treatment: medicalRecords.treatment,
        date: medicalRecords.date,
        patientName: patients.name,
      })
      .from(medicalRecords)
      .innerJoin(patients, eq(medicalRecords.patientId, patients.id))
      .orderBy(medicalRecords.date)

    if (records.length === 0) {
      return c.json({ success: true, data: [] })
    }

    // 2. Compute overall time window and batch-fetch payments + expenses
    const win = overallWindow(records.map((r) => r.date))
    const patientIds = Array.from(new Set(records.map((r) => r.patientId)))

    const [allPayments, allExpenses] = win
      ? await Promise.all([
          db
            .select()
            .from(payments)
            .where(
              and(
                inArray(payments.patientId, patientIds),
                gte(payments.createdAt, win.min),
                lte(payments.createdAt, win.max)
              )
            ),
          db
            .select()
            .from(expenses)
            .where(and(gte(expenses.date, win.min), lte(expenses.date, win.max))),
        ])
      : [[], []]

    // 3. Index payments by patient for faster membership checks (skip walk-ins w/ null patientId)
    const paymentsByPatient = new Map<string, typeof allPayments>()
    for (const p of allPayments) {
      if (!p.patientId) continue
      const list = paymentsByPatient.get(p.patientId)
      if (list) list.push(p)
      else paymentsByPatient.set(p.patientId, [p])
    }

    // 4. For each record, count matches within its ±7-day window — O(n*m) but in-memory
    const recordsWithCounts = records.map((record) => {
      const lower = record.date.getTime() - WINDOW_MS
      const upper = record.date.getTime() + WINDOW_MS

      const patientPayments = paymentsByPatient.get(record.patientId) ?? []
      const paymentCount = patientPayments.reduce((n, p) => {
        const t =
          p.createdAt instanceof Date
            ? p.createdAt.getTime()
            : new Date(p.createdAt as any).getTime()
        return t >= lower && t <= upper ? n + 1 : n
      }, 0)

      const expenseCount = allExpenses.reduce((n, e) => {
        const t = e.date instanceof Date ? e.date.getTime() : new Date(e.date as any).getTime()
        return t >= lower && t <= upper ? n + 1 : n
      }, 0)

      return {
        ...record,
        relatedDataCounts: {
          payments: paymentCount,
          expenses: expenseCount,
          inventoryUsage: 0,
          products: 0,
        },
      }
    })

    return c.json({ success: true, data: recordsWithCounts })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

syncPreviewApp.get('/:recordId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const recordId = c.req.param('recordId')
  const syncOptions = {
    patients: c.req.query('patients') === 'true',
    treatments: c.req.query('treatments') === 'true',
    payments: c.req.query('payments') === 'true',
    expenses: c.req.query('expenses') === 'true',
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const record = await db.query.medicalRecords.findFirst({
      where: eq(medicalRecords.id, recordId),
    })
    if (!record) return c.json({ error: 'Not found' }, 404)

    const preview: any = { recordId, recordDate: record.date, dataToSync: [] }

    if (syncOptions.patients) {
      const patient = await db.query.patients.findFirst({
        where: eq(patients.id, record.patientId),
      })
      if (patient)
        preview.dataToSync.push({
          type: 'Patient',
          count: 1,
          items: [{ id: patient.id, name: patient.name }],
        })
    }

    if (syncOptions.treatments) {
      preview.dataToSync.push({
        type: 'Treatment',
        count: 1,
        items: [{ id: record.id, treatment: record.treatment, date: record.date }],
      })
    }

    if (syncOptions.payments) {
      const relatedPayments = await db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.patientId, record.patientId),
            gte(payments.createdAt, new Date(record.date.getTime() - WINDOW_MS)),
            lte(payments.createdAt, new Date(record.date.getTime() + WINDOW_MS))
          )
        )
      preview.dataToSync.push({
        type: 'Payments',
        count: relatedPayments.length,
        items: relatedPayments.map((p) => ({ id: p.id, amount: p.amount, method: p.method })),
      })
    }

    if (syncOptions.expenses) {
      const relatedExpenses = await db
        .select()
        .from(expenses)
        .where(
          and(
            gte(expenses.date, new Date(record.date.getTime() - WINDOW_MS)),
            lte(expenses.date, new Date(record.date.getTime() + WINDOW_MS))
          )
        )
      preview.dataToSync.push({
        type: 'Expenses',
        count: relatedExpenses.length,
        items: relatedExpenses.map((e) => ({
          id: e.id,
          description: e.description,
          amount: e.amount,
        })),
      })
    }

    return c.json({ success: true, data: preview })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

export { syncPreviewApp }
