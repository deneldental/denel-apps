/**
 * estimates.ts — the clinical view of an estimate (decision D2, audit F02).
 *
 * An estimate is a draft one-time invoice, but a doctor who builds one has no
 * business with payments, receipts or the ledger. Everything a doctor needs to
 * read an estimate sits here behind its own `estimates` permission, and returns an
 * explicit, short list of fields: the lines, the quoted totals and the status. No
 * payment history, no balance, no patient record, no ledger accounts. The general
 * invoice endpoints (`/api/invoices/*`) stay behind `payments:*`.
 *
 * `payments` and `financial_records` imply `estimates` (MODULE_HIERARCHY), so
 * reception and finance keep the access they had.
 */

import { and, asc, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { env } from '../config/env'
import { getDb } from '../db'
import { invoiceLines, invoices } from '../db/schema'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

export const estimatesApp = new Hono<HonoEnv>()

const uuid = z.string().uuid()

/** What a clinician needs to recognise an estimate in a list. */
const LIST_COLUMNS = {
  id: invoices.id,
  invoiceNumber: invoices.invoiceNumber,
  description: invoices.description,
  status: invoices.status,
  total: invoices.total,
  createdAt: invoices.createdAt,
}

// GET /api/estimates/patient/:patientId — a patient's estimates, newest first.
estimatesApp.get('/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.ESTIMATES as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  // A malformed id is simply "no such patient": it must not reach the database,
  // where Postgres would reject it and the failure would come back as a 500.
  const patientId = uuid.safeParse(c.req.param('patientId'))
  if (!patientId.success) return c.json({ error: 'Not found' }, 404)

  try {
    const db = getDb(env.DATABASE_URL)
    const data = await db
      .select(LIST_COLUMNS)
      .from(invoices)
      .where(and(eq(invoices.patientId, patientId.data), eq(invoices.type, 'one_time')))
      .orderBy(desc(invoices.createdAt))
    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { context: 'Estimates list', patientId: patientId.data })
    return c.json({ error: 'Failed to load estimates' }, 500)
  }
})

// GET /api/estimates/:id — one estimate with its lines.
estimatesApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.ESTIMATES as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = uuid.safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Not found' }, 404)

  try {
    const db = getDb(env.DATABASE_URL)
    const [estimate] = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        description: invoices.description,
        status: invoices.status,
        currency: invoices.currency,
        visitFrequency: invoices.visitFrequency,
        patientId: invoices.patientId,
        appointmentId: invoices.appointmentId,
        subtotal: invoices.subtotal,
        discountTotal: invoices.discountTotal,
        taxTotal: invoices.taxTotal,
        total: invoices.total,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      // An invoice that is not an estimate (a plan instalment, say) is not found
      // here, however the id was obtained.
      .where(and(eq(invoices.id, id.data), eq(invoices.type, 'one_time')))
    if (!estimate) return c.json({ error: 'Not found' }, 404)

    const lines = await db
      .select({
        id: invoiceLines.id,
        // The catalogue service: the treatment-plan builder carries it onto the plan.
        serviceId: invoiceLines.serviceId,
        description: invoiceLines.description,
        variantName: invoiceLines.variantName,
        quantity: invoiceLines.quantity,
        unitPrice: invoiceLines.unitPrice,
        // With `unitPrice`, a first-unit / additional-unit line's step (G01) can be shown.
        lineSubtotal: invoiceLines.lineSubtotal,
        lineTotal: invoiceLines.lineTotal,
      })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, estimate.id))
      .orderBy(asc(invoiceLines.lineNumber))

    return c.json({ success: true, data: { ...estimate, lines } })
  } catch (error) {
    logError(error, { context: 'Estimate view', estimateId: id.data })
    return c.json({ error: 'Failed to load estimate' }, 500)
  }
})
