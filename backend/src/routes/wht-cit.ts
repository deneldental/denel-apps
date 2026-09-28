/**
 * wht-cit.ts — admin-v1 F3/F4
 *
 * F3: WHT credit certificate management.
 * F4: CIT installment tracking.
 *
 * Routes:
 *   GET  /api/wht-certificates              — list (filter: taxYear, partyType)
 *   POST /api/wht-certificates              — record a new WHT certificate
 *   POST /api/wht-certificates/:id/remit    — mark as remitted to GRA
 *
 *   GET  /api/cit-installments              — list (filter: taxYear)
 *   POST /api/cit-installments              — record or upsert a quarter's entry
 *   PATCH /api/cit-installments/:id/pay     — record payment (paidAmount + paidAt)
 */

import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { citInstallments, journalEntries, whtCreditCertificates } from '../db/schema'
import { getAccountByCode } from '../lib/channel-accounts'
import { FINANCE_ACCOUNTS } from '../lib/finance-accounts'
import { postInOpenPeriod } from '../lib/gl-service'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

export const whtCitApp = new Hono<HonoEnv>()

// ── WHT Certificates ──────────────────────────────────────────────────────────

whtCitApp.get('/wht-certificates', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.ACCOUNTS, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const { taxYear, partyType } = c.req.query()

  try {
    let query = db.select().from(whtCreditCertificates).$dynamic()
    if (taxYear) query = query.where(eq(whtCreditCertificates.taxYear, Number(taxYear)))
    const rows = await query.orderBy(desc(whtCreditCertificates.createdAt))
    return c.json({
      success: true,
      data: partyType ? rows.filter((r) => r.partyType === partyType) : rows,
    })
  } catch (err) {
    logError(err, { context: '[wht-cit] list wht certs' })
    return c.json({ error: 'Failed to fetch WHT certificates' }, 500)
  }
})

const whtCertSchema = z.object({
  partyType: z.enum(['specialist', 'supplier']),
  partyId: z.string().uuid(),
  taxYear: z.number().int(),
  taxMonth: z.number().int().min(1).max(12).optional(),
  certificateRef: z.string().optional(),
  grossAmount: z.number().positive(),
  whtRate: z.number().min(0).max(1),
  whtAmount: z.number().min(0),
  journalEntryId: z.string().uuid().optional(),
  issuedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
})

whtCitApp.post('/wht-certificates', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.ACCOUNTS, ACTIONS.CREATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const parsed = whtCertSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)

  try {
    const [row] = await db
      .insert(whtCreditCertificates)
      .values({
        ...parsed.data,
        issuedAt: parsed.data.issuedAt ? new Date(parsed.data.issuedAt) : null,
        createdById: user.id,
      })
      .returning()

    // GL: DR WHT Expense / CR WHT Payable (idempotent on wht_certificate + cert.id)
    try {
      const [expenseAcct, payableAcct] = await Promise.all([
        getAccountByCode(db, FINANCE_ACCOUNTS.WHT_EXPENSE),
        getAccountByCode(db, FINANCE_ACCOUNTS.WHT_PAYABLE),
      ])
      await postInOpenPeriod(
        db,
        {
          sourceDocType: 'wht_certificate',
          sourceDocId: row.id,
          description: `WHT cert ${row.certificateRef ?? row.id} — ${row.partyType}`,
          lines: [
            { accountId: expenseAcct.id, debit: Number(row.whtAmount) },
            { accountId: payableAcct.id, credit: Number(row.whtAmount) },
          ],
          createdBy: user.id,
        },
        new Date()
      )
      // Persist the GL entry ID back to the cert for audit linkage.
      const glEntry = await db.query.journalEntries.findFirst({
        where: and(
          eq(journalEntries.sourceDocType, 'wht_certificate'),
          eq(journalEntries.sourceDocId, row.id)
        ),
        columns: { id: true },
      })
      if (glEntry) {
        await db
          .update(whtCreditCertificates)
          .set({ journalEntryId: glEntry.id })
          .where(eq(whtCreditCertificates.id, row.id))
        row.journalEntryId = glEntry.id
      }
    } catch (glErr) {
      logError(glErr, { context: '[wht-cit] gl post on cert create', certId: row.id })
    }

    return c.json({ success: true, data: row }, 201)
  } catch (err) {
    logError(err, { context: '[wht-cit] create wht cert' })
    return c.json({ error: 'Failed to create WHT certificate' }, 500)
  }
})

whtCitApp.post('/wht-certificates/:id/remit', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.ACCOUNTS, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const { id } = c.req.param()

  try {
    const [row] = await db
      .update(whtCreditCertificates)
      .set({ remittedAt: new Date() })
      .where(eq(whtCreditCertificates.id, id))
      .returning()
    if (!row) return c.json({ error: 'Not found' }, 404)

    // GL: DR WHT Payable / CR Bank (idempotent on remittance + cert.id)
    try {
      const [payableAcct, bankAcct] = await Promise.all([
        getAccountByCode(db, FINANCE_ACCOUNTS.WHT_PAYABLE),
        getAccountByCode(db, FINANCE_ACCOUNTS.BANK), // bank_transfer
      ])
      await postInOpenPeriod(
        db,
        {
          sourceDocType: 'remittance',
          sourceDocId: row.id,
          description: `WHT remittance ${row.certificateRef ?? row.id}`,
          lines: [
            { accountId: payableAcct.id, debit: Number(row.whtAmount) },
            { accountId: bankAcct.id, credit: Number(row.whtAmount) },
          ],
          createdBy: user.id,
        },
        new Date()
      )
      // Persist the GL entry ID back to the cert for audit linkage.
      const glEntry = await db.query.journalEntries.findFirst({
        where: and(
          eq(journalEntries.sourceDocType, 'remittance'),
          eq(journalEntries.sourceDocId, row.id)
        ),
        columns: { id: true },
      })
      if (glEntry) {
        await db
          .update(whtCreditCertificates)
          .set({ journalEntryId: glEntry.id })
          .where(eq(whtCreditCertificates.id, row.id))
        row.journalEntryId = glEntry.id
      }
    } catch (glErr) {
      logError(glErr, { context: '[wht-cit] gl post on cert remit', certId: id })
    }

    return c.json({ success: true, data: row })
  } catch (err) {
    logError(err, { context: '[wht-cit] remit wht cert' })
    return c.json({ error: 'Failed to update WHT certificate' }, 500)
  }
})

// ── CIT Installments ──────────────────────────────────────────────────────────

whtCitApp.get('/cit-installments', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.ACCOUNTS, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const { taxYear } = c.req.query()

  try {
    let query = db.select().from(citInstallments).$dynamic()
    if (taxYear) query = query.where(eq(citInstallments.taxYear, Number(taxYear)))
    const rows = await query.orderBy(desc(citInstallments.taxYear), desc(citInstallments.quarter))
    return c.json({ success: true, data: rows })
  } catch (err) {
    logError(err, { context: '[wht-cit] list cit installments' })
    return c.json({ error: 'Failed to fetch CIT installments' }, 500)
  }
})

const citInstallmentSchema = z.object({
  taxYear: z.number().int(),
  quarter: z.number().int().min(1).max(4),
  dueDate: z.string().date(),
  estimatedAmount: z.number().optional(),
  notes: z.string().optional(),
})

whtCitApp.post('/cit-installments', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.ACCOUNTS, ACTIONS.CREATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const parsed = citInstallmentSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)

  try {
    const [row] = await db
      .insert(citInstallments)
      .values({ ...parsed.data, createdById: user.id })
      .onConflictDoUpdate({
        target: [citInstallments.taxYear, citInstallments.quarter],
        set: {
          dueDate: parsed.data.dueDate,
          estimatedAmount: parsed.data.estimatedAmount ?? null,
          notes: parsed.data.notes ?? null,
        },
      })
      .returning()
    return c.json({ success: true, data: row }, 201)
  } catch (err) {
    logError(err, { context: '[wht-cit] upsert cit installment' })
    return c.json({ error: 'Failed to save CIT installment' }, 500)
  }
})

const paySchema = z.object({
  paidAmount: z.number().positive(),
  paidAt: z.string().datetime().optional(),
})

whtCitApp.patch('/cit-installments/:id/pay', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.ACCOUNTS, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const { id } = c.req.param()
  const parsed = paySchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)

  try {
    const [row] = await db
      .update(citInstallments)
      .set({
        paidAmount: parsed.data.paidAmount,
        paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date(),
      })
      .where(eq(citInstallments.id, id))
      .returning()
    if (!row) return c.json({ error: 'Not found' }, 404)

    // GL: DR CIT Expense / CR Bank (idempotent on cit_installment + installment.id)
    try {
      const [expenseAcct, bankAcct] = await Promise.all([
        getAccountByCode(db, FINANCE_ACCOUNTS.CIT_EXPENSE),
        getAccountByCode(db, FINANCE_ACCOUNTS.BANK), // bank_transfer
      ])
      const amount = Number(row.paidAmount)
      await postInOpenPeriod(
        db,
        {
          sourceDocType: 'cit_installment',
          sourceDocId: row.id,
          description: `CIT Q${row.quarter} ${row.taxYear} installment`,
          lines: [
            { accountId: expenseAcct.id, debit: amount },
            { accountId: bankAcct.id, credit: amount },
          ],
          createdBy: user.id,
        },
        row.paidAt ?? new Date()
      )
      // Persist the GL entry ID back to the installment for audit linkage.
      const glEntry = await db.query.journalEntries.findFirst({
        where: and(
          eq(journalEntries.sourceDocType, 'cit_installment'),
          eq(journalEntries.sourceDocId, row.id)
        ),
        columns: { id: true },
      })
      if (glEntry) {
        await db
          .update(citInstallments)
          .set({ journalEntryId: glEntry.id })
          .where(eq(citInstallments.id, row.id))
        row.journalEntryId = glEntry.id
      }
    } catch (glErr) {
      logError(glErr, { context: '[wht-cit] gl post on cit pay', installmentId: id })
    }

    return c.json({ success: true, data: row })
  } catch (err) {
    logError(err, { context: '[wht-cit] pay cit installment' })
    return c.json({ error: 'Failed to record CIT payment' }, 500)
  }
})
