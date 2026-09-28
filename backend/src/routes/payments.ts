import { and, asc, count, desc, eq, inArray, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import {
  appointments,
  invoiceLines,
  invoices,
  patientBalances,
  patients,
  paymentAllocations,
  paymentPlans,
  payments,
  walletTransactions,
} from '../db/schema'
import { createAuditLog, recordDiffAudit } from '../lib/audit'
import { getBranding } from '../lib/branding'
import { errMessage } from '../lib/error-message'
import { recalculatePlanBalances } from '../lib/ledger-utils'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import {
  applyCreditToInvoice,
  type CreatePaymentInput,
  createDraftPayment,
  getPatientsWithCredit,
  postPayment,
  postRefund,
  recordLegacyPayment,
  reversePayment,
} from '../lib/payment-service'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { sendSMS } from '../lib/sms'
import { resolveSmsTemplate } from '../lib/sms-templates'
import type { HonoEnv } from '../lib/types'

const paymentsApp = new Hono<HonoEnv>()

const MODULE = MODULES.PAYMENTS

// ── L17: zod request schemas ────────────────────────────────────────────────
const moneyLike = z.union([z.string(), z.number()])

const allocationSchema = z.object({
  targetType: z.enum(['invoice', 'bill']),
  targetId: z.string().uuid(),
  amount: moneyLike,
  notes: z.string().nullish(),
})

const draftPaymentSchema = z.object({
  patientId: z.string().uuid(),
  amount: moneyLike,
  method: z.string().min(1),
  paymentDate: z.string().nullish(),
  externalReference: z.string().nullish(),
  description: z.string().nullish(),
  appointmentId: z.string().uuid().nullish(),
  paymentPlanId: z.string().uuid().nullish(),
  allocations: z.array(allocationSchema).optional(),
  paymentGroupId: z.string().uuid().nullish(),
})

const reverseSchema = z.object({ reason: z.string().trim().min(1) })

const applyCreditSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: moneyLike,
})

const refundSchema = z.object({
  patientId: z.string().uuid(),
  amount: moneyLike,
  method: z.string().min(1),
  paymentDate: z.string().nullish(),
  externalReference: z.string().nullish(),
  description: z.string().nullish(),
})

// PATCH /:id allow-list — editable metadata only. Monetary + GL-controlled
// columns (amount, status, balance, allocatedAmount, unallocatedAmount,
// journalEntryId, posting timestamps) and identity (patientId, paymentPlanId,
// patient/party links) are owned by the posting service and the recompute
// pipeline; mutating them here would silently desync cash/AR from the GL. They
// are intentionally excluded so a raw body can't mass-assign them.
const patchPaymentSchema = z
  .object({
    method: z.string().min(1).optional(),
    description: z.string().nullish(),
    externalReference: z.string().nullish(),
    transactionId: z.string().nullish(),
    paymentDate: z.string().nullish(),
    sendNotification: z.boolean().optional(),
  })
  .strict()

/** Pull a clean message off an unknown thrown value (L17: `catch` is `unknown`). */
paymentsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1)
    const limit = Math.min(
      200,
      Math.max(1, Number.parseInt(c.req.query('limit') ?? '100', 10) || 100)
    )
    const offset = (page - 1) * limit

    const [rows, countRows] = await Promise.all([
      db
        .select({
          payment: payments,
          patient: patients,
          paymentPlan: paymentPlans,
        })
        .from(payments)
        .leftJoin(patients, eq(payments.patientId, patients.id))
        .leftJoin(paymentPlans, eq(payments.paymentPlanId, paymentPlans.id))
        .orderBy(desc(payments.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(payments),
    ])

    const total = countRows[0]?.total ?? 0
    const data = rows.map((row) => ({
      ...row.payment,
      patient: row.patient,
      paymentPlan: row.paymentPlan,
    }))

    return c.json({ success: true, data, total, limit, page })
  } catch (error: unknown) {
    logError(error, { context: 'Error fetching payments' })
    return c.json({ error: 'Failed to fetch payments' }, 500)
  }
})

paymentsApp.get('/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const patientId = c.req.param('patientId')
    const db = getDb(process.env.DATABASE_URL!)
    const data = await db
      .select()
      .from(payments)
      .where(eq(payments.patientId, patientId))
      .orderBy(desc(payments.createdAt))
    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: 'Error fetching patient payments' })
    return c.json({ error: 'Failed to fetch patient payments' }, 500)
  }
})

// GET /patients-with-credit — every patient with a positive deposit balance,
// in one query (remediation H19; replaces the /refunds page's per-patient
// loop). MUST stay registered before the `/:id` route below — otherwise Hono
// matches "patients-with-credit" as a payment id and the UUID lookup 500s.
paymentsApp.get('/patients-with-credit', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const data = await getPatientsWithCredit(db)
    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: 'Error fetching patients with credit' })
    return c.json({ error: 'Failed to fetch patients with credit' }, 500)
  }
})

paymentsApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    const [data] = await db.select().from(payments).where(eq(payments.id, id)).limit(1)
    if (!data) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch payment' }, 500)
  }
})

// GET /:id/receipt — receipt-ready payload for the view/print dialog.
// Shape matches `ReceiptViewDialogProps` in portals/src/features/payments/components/receipt-view-dialog.tsx.
//
// `?source=payment` (default) — look up the payments table.
// `?source=wallet`            — look up wallet_transactions (for wallet credits/debits).
paymentsApp.get('/:id/receipt', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const source = c.req.query('source') === 'wallet' ? 'wallet' : 'payment'
    const db = getDb(process.env.DATABASE_URL!)

    // Clinic identity always comes from Integrations → Branding (the single
    // source of truth after the Settings cleanup). `getBranding()` already
    // layers env-var defaults under the persisted config.
    const branding = await getBranding()
    const clinicName = branding.name
    const clinicPhone = branding.phones?.[0] ?? null
    const clinicAddress = branding.address ?? null
    const clinicWebsite = branding.website ?? null

    if (source === 'wallet') {
      const [wt] = await db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.id, id))
        .limit(1)
      if (!wt) return c.json({ error: 'Not found' }, 404)

      const [patient] = await db
        .select()
        .from(patients)
        .where(eq(patients.id, wt.patientId))
        .limit(1)

      return c.json({
        success: true,
        data: {
          patientName: patient?.name ?? 'Unknown Patient',
          appointmentDate: undefined,
          amountPaid: Math.abs(wt.amount),
          totalAmount: undefined,
          balance: wt.balanceAfter,
          paymentType: wt.type === 'credit' ? 'wallet_credit' : 'wallet_debit',
          paymentFor: wt.description,
          notes: null,
          clinicName,
          clinicPhone,
          clinicAddress,
          clinicWebsite,
          generatedAt: new Date(wt.createdAt).toLocaleString(),
        },
      })
    }

    const [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1)
    if (!payment) return c.json({ error: 'Not found' }, 404)

    // Sibling payments in the same split (if any). The receipt represents the
    // whole group, not just the clicked row, so wallet+cash split shows as
    // "Payment Method 1: wallet 500 | Payment Method 2: cash 200".
    const siblingPayments = payment.paymentGroupId
      ? await db
          .select()
          .from(payments)
          .where(eq(payments.paymentGroupId, payment.paymentGroupId))
          .orderBy(asc(payments.createdAt))
      : [payment]

    // Patient (for cardholder name).
    const [patient] = payment.patientId
      ? await db.select().from(patients).where(eq(patients.id, payment.patientId)).limit(1)
      : [null]

    // Optional appointment linkage — used for the "Date" line on the receipt.
    const [appointment] = payment.appointmentId
      ? await db
          .select()
          .from(appointments)
          .where(eq(appointments.id, payment.appointmentId))
          .limit(1)
      : [null]

    // Per-invoice allocations across every sibling payment in the group so
    // a split-payment receipt shows the combined "Applied to" picture.
    const siblingIds = siblingPayments.map((p) => p.id)
    const allocRows = await db
      .select()
      .from(paymentAllocations)
      .where(inArray(paymentAllocations.paymentId, siblingIds))
    const invIds = [
      ...new Set(allocRows.filter((a) => a.targetType === 'invoice').map((a) => a.targetId)),
    ]
    const allocInvoices = invIds.length
      ? await db.select().from(invoices).where(inArray(invoices.id, invIds))
      : []
    const invById = new Map(allocInvoices.map((i) => [i.id, i]))
    // Pull every line item for the allocated invoices in one batch so the
    // receipt can show the real treatment names (linked via services).
    const allocLines = invIds.length
      ? await db
          .select()
          .from(invoiceLines)
          .where(inArray(invoiceLines.invoiceId, invIds))
          .orderBy(asc(invoiceLines.invoiceId), asc(invoiceLines.lineNumber))
      : []
    const linesByInvoice = allocLines.reduce((map, line) => {
      const arr = map.get(line.invoiceId) ?? []
      arr.push(line)
      map.set(line.invoiceId, arr)
      return map
    }, new Map<string, typeof allocLines>())

    // Aggregate allocations across siblings — one row per invoice, even when
    // multiple sibling payments contributed to the same invoice.
    type AggAlloc = {
      invoiceNumber: string
      invoiceTotal: number | null
      invoiceSubtotal: number | null
      invoiceTaxTotal: number | null
      amountApplied: number
      remainingBalance: number | null
      status: string | null
      treatments: string[]
      items: { name: string; cost: number }[]
    }
    const aggByInvoice = new Map<string, AggAlloc>()
    for (const a of allocRows) {
      if (a.targetType !== 'invoice') continue
      const inv = invById.get(a.targetId)
      const lines = linesByInvoice.get(a.targetId) ?? []
      const treatmentNames = lines.map((l) => l.description?.trim()).filter((s): s is string => !!s)
      const items = lines.map((l) => ({
        name: l.description?.trim() || 'Unknown Item',
        cost: Number(l.lineTotal),
      }))
      const existing = aggByInvoice.get(a.targetId)
      if (existing) {
        existing.amountApplied += Number(a.amount)
      } else {
        aggByInvoice.set(a.targetId, {
          invoiceNumber: inv?.invoiceNumber ?? a.targetId.slice(0, 8),
          invoiceTotal: inv ? Number(inv.total ?? inv.amount) : null,
          invoiceSubtotal: inv ? Number(inv.subtotal ?? 0) : null,
          invoiceTaxTotal: inv ? Number(inv.taxTotal ?? 0) : null,
          amountApplied: Number(a.amount),
          remainingBalance: inv
            ? Number(inv.balance ?? Number(inv.amount) - Number(inv.paidAmount))
            : null,
          status: inv?.status ?? null,
          treatments: treatmentNames,
          items: items,
        })
      }
    }
    const allocations = [...aggByInvoice.values()]
    const unallocatedAmount = siblingPayments.reduce(
      (s, p) => s + Number(p.unallocatedAmount ?? 0),
      0
    )

    // "Service" label = aggregated treatment names across all allocated
    // invoices. Falls back to legacy `payment.treatments` JSONB, then free-
    // text description for older / non-allocated payments.
    const legacyTreatments = Array.isArray(payment.treatments) ? payment.treatments : []
    const allTreatmentNames = allocations.flatMap((a) => a.treatments)
    const paymentFor =
      allTreatmentNames.length > 0
        ? [...new Set(allTreatmentNames)].join(', ')
        : legacyTreatments.length > 0
          ? legacyTreatments.map((t) => t.name).join(', ')
          : (payment.description?.split(' - ')[0] ?? payment.description ?? 'Service Payment')

    const appointmentDate = appointment?.date
      ? new Date(appointment.date).toLocaleString()
      : undefined

    const totalPaid = siblingPayments.reduce((s, p) => s + Number(p.amount), 0)
    const methods = siblingPayments.map((p) => ({
      method: p.method,
      amount: Number(p.amount),
      reference: p.externalReference ?? null,
      paymentNumber: p.paymentNumber ?? null,
    }))
    // Reference shown on the slip = the invoice number(s) this payment
    // settled, plus the underlying payment numbers for audit. The frontend
    // can pick which to display.
    const invoiceNumbers = allocations.map((a) => a.invoiceNumber)
    const paymentNumbers = siblingPayments
      .map((p) => p.paymentNumber)
      .filter((n): n is string => !!n)

    // Resolve total amount and actual remaining balance:
    // 1. If payment is linked to a payment plan, resolve plan total and actual plan balance.
    // 2. Otherwise, if allocated to invoices, resolve aggregate invoice total and remaining balance.
    let totalAmount: number | undefined
    let balance: number | undefined

    if (payment.paymentPlanId) {
      const [plan] = await db
        .select()
        .from(paymentPlans)
        .where(eq(paymentPlans.id, payment.paymentPlanId))
        .limit(1)

      if (plan) {
        totalAmount = Number(plan.totalAmount)
        if (plan.invoiceId) {
          const [masterInv] = await db
            .select()
            .from(invoices)
            .where(eq(invoices.id, plan.invoiceId))
            .limit(1)
          if (masterInv) {
            balance = Number(masterInv.balance)
          }
        }
        if (balance === undefined) {
          const planPayments = await db
            .select()
            .from(payments)
            .where(
              and(
                eq(payments.paymentPlanId, plan.id),
                or(eq(payments.status, 'posted'), eq(payments.status, 'completed'))
              )
            )
          const totalPlanPaid = planPayments.reduce((sum, p) => sum + Number(p.amount), 0)
          balance = Math.max(0, Number(plan.totalAmount) - totalPlanPaid)
        }
      }
    } else if (allocations.length > 0) {
      const hasTotals = allocations.some((a) => a.invoiceTotal != null)
      if (hasTotals) {
        totalAmount = allocations.reduce((sum, a) => sum + (a.invoiceTotal ?? 0), 0)
      }
      const hasBalances = allocations.some((a) => a.remainingBalance != null)
      if (hasBalances) {
        balance = allocations.reduce((sum, a) => sum + (a.remainingBalance ?? 0), 0)
      }
    }

    return c.json({
      success: true,
      data: {
        patientName: patient?.name ?? 'Unknown Patient',
        appointmentDate,
        amountPaid: totalPaid,
        totalAmount,
        balance,
        // Legacy single-method field kept for back-compat; new UI reads `methods`.
        paymentType: payment.method,
        methods,
        paymentFor,
        notes: payment.description ?? null,
        paymentNumber: payment.paymentNumber ?? null,
        paymentNumbers,
        invoiceNumbers,
        allocations,
        unallocatedAmount,
        clinicName,
        clinicPhone,
        clinicAddress,
        clinicWebsite,
        generatedAt: new Date(payment.createdAt).toLocaleString(),
      },
    })
  } catch (error: unknown) {
    logError(error, { context: 'Error fetching payment receipt' })
    return c.json({ error: 'Failed to fetch payment receipt' }, 500)
  }
})

paymentsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const data = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    // C4: the legacy direct-insert path wrote a `posted` payment with NO
    // journal entry — it was invisible to the GL, so cash and AR drifted
    // permanently. `recordLegacyPayment` routes the same request shape through
    // the Phase-3 service so every payment writes a balanced JE. The request
    // and response shapes stay backward-compatible for the existing portal
    // dialogs; R6 migrates those dialogs to the explicit /draft + /:id/post flow.
    if (!data.patientId) return c.json({ error: 'patientId is required' }, 400)
    if (data.amount === undefined || Number(data.amount) <= 0)
      return c.json({ error: 'amount must be a positive number' }, 400)
    if (!data.method) return c.json({ error: 'method is required' }, 400)

    const { payment: newItem, targetInvoiceId } = await recordLegacyPayment(
      db,
      {
        patientId: data.patientId,
        amount: data.amount,
        method: data.method,
        paymentDate: data.paymentDate ? new Date(data.paymentDate) : undefined,
        description: data.description ?? null,
        appointmentId: data.appointmentId ?? null,
        paymentPlanId: data.paymentPlanId ?? null,
        invoiceId: data.invoiceId ?? null,
        transactionId: data.transactionId ?? null,
        externalReference: data.externalReference ?? null,
        treatments: data.treatments,
        sendNotification: data.sendNotification,
      },
      user.id
    )

    // SMS balance: for a plan / invoice payment, the outstanding figure is the
    // target invoice's balance after this posting.
    let balance: number | null = null
    if (targetInvoiceId) {
      const inv = await db.query.invoices.findFirst({ where: eq(invoices.id, targetInvoiceId) })
      balance = inv ? Number(inv.balance) : null
      newItem.balance = balance
    }

    c.set('skipAudit', true)
    const [patient] = await db
      .select()
      .from(patients)
      .where(eq(patients.id, data.patientId))
      .limit(1)

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'payments',
      entityId: newItem.id,
      entityName: patient ? `Payment for ${patient.name}` : 'Payment',
      changes: data,
    })

    if (data.sendNotification && data.patientId) {
      if (patient && (patient.phone || (patient.isChild && patient.guardianPhone))) {
        // Both are integer CENTS; the SMS shows cedis.
        const amountGHS = (Number(data.amount) / 100).toFixed(2)
        const balanceGHS = balance !== null ? (Number(balance) / 100).toFixed(2) : '0.00'

        const descriptionText = data.description || ''
        const treatmentTypes = descriptionText.split(' - ')[0] || 'Service Payment'

        let message = ''
        if (data.paymentPlanId) {
          const template = await resolveSmsTemplate(
            db,
            'payment:with_balance',
            process.env.PAYMENT_PLAN_SMS ||
              'Dear {Patientname}, thank you for your payment of GHS {amount} for {treatmenttypes}. Your current balance is GHS {balance}. Thank you!'
          )
          message = template
            .replace(/{Patientname}/g, patient.name)
            .replace(/{amount}/g, amountGHS)
            .replace(/{treatmenttypes}/g, treatmentTypes)
            .replace(/{balance}/g, balanceGHS)
        } else {
          const template = await resolveSmsTemplate(
            db,
            'payment:confirmation',
            process.env.PAYMENT_SMS ||
              'Dear {Patientname}, thank you for your payment of GHS {amount} for {treatmenttypes}. Thank you!'
          )
          message = template
            .replace(/{Patientname}/g, patient.name)
            .replace(/{amount}/g, amountGHS)
            .replace(/{treatmenttypes}/g, treatmentTypes)
        }

        const contactPhone =
          patient.isChild && patient.guardianPhone ? patient.guardianPhone : patient.phone!
        await sendSMS(
          [{ phone: contactPhone, message, patientId: patient.id }],
          undefined,
          'bulk',
          user.id
        )
      }
    }

    return c.json({ success: true, data: newItem })
  } catch (error: unknown) {
    logError(error, { context: 'Error creating payment' })
    return c.json({ error: 'Failed to create payment' }, 500)
  }
})

paymentsApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const parsed = patchPaymentSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
    }
    const data = parsed.data
    const db = getDb(process.env.DATABASE_URL!)

    // Build the update object from the allow-list only — never spread raw input.
    const updateData: Partial<typeof payments.$inferInsert> = {}
    if (data.method !== undefined) updateData.method = data.method
    if (data.description !== undefined) updateData.description = data.description ?? null
    if (data.externalReference !== undefined)
      updateData.externalReference = data.externalReference ?? null
    if (data.transactionId !== undefined) updateData.transactionId = data.transactionId ?? null
    if (data.paymentDate !== undefined) updateData.paymentDate = data.paymentDate ?? null
    if (data.sendNotification !== undefined) updateData.sendNotification = data.sendNotification

    const [updated] = await db
      .update(payments)
      .set(updateData)
      .where(eq(payments.id, id))
      .returning()
    if (!updated) return c.json({ error: 'Payment not found' }, 404)

    if (updated.paymentPlanId) {
      await recalculatePlanBalances(db, updated.paymentPlanId)
    }

    c.set('skipAudit', true)
    const [patient] = updated.patientId
      ? await db.select().from(patients).where(eq(patients.id, updated.patientId)).limit(1)
      : [null]

    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'payments',
      entityId: id,
      entityName: patient ? `Payment for ${patient.name}` : 'Payment',
      changes: data,
    })

    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to update payment' }, 500)
  }
})

paymentsApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)

    const [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1)
    if (!payment) return c.json({ error: 'Not found' }, 404)

    await db.delete(payments).where(eq(payments.id, id))

    if (payment.paymentPlanId) {
      await recalculatePlanBalances(db, payment.paymentPlanId)
    }

    c.set('skipAudit', true)
    const [patient] = payment.patientId
      ? await db.select().from(patients).where(eq(patients.id, payment.patientId)).limit(1)
      : [null]

    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: 'payments',
      entityId: id,
      entityName: patient ? `Payment for ${patient.name}` : 'Payment',
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to delete payment' }, 500)
  }
})

// ── Phase 3: draft → post lifecycle with allocations ────────────────────────

// POST /api/payments/draft — create a draft payment (optionally pre-allocated)
paymentsApp.post('/draft', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const parsed = draftPaymentSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const input: CreatePaymentInput = {
      patientId: body.patientId,
      amount: body.amount,
      method: body.method as CreatePaymentInput['method'],
      paymentDate: body.paymentDate ? new Date(body.paymentDate) : undefined,
      externalReference: body.externalReference ?? null,
      description: body.description ?? null,
      appointmentId: body.appointmentId ?? null,
      paymentPlanId: body.paymentPlanId ?? null,
      allocations: body.allocations,
      paymentGroupId: body.paymentGroupId ?? null,
    }
    const result = await createDraftPayment(db, input, user.id)
    return c.json({ success: true, data: result.payment })
  } catch (err) {
    logError(err, { context: 'createDraftPayment', patientId: body.patientId })
    return c.json({ error: errMessage(err, 'Failed to create draft payment') }, 400)
  }
})

// POST /api/payments/:id/post — transition draft → posted (writes JE)
paymentsApp.post('/:id/post', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const result = await postPayment(db, id, user.id)
    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: 'payments',
      entityId: id,
      entityName: `Payment ${result.payment.paymentNumber ?? id}`,
      before: { status: 'draft' },
      after: { status: result.payment.status, journalEntryId: result.journalEntry.id },
      reason: null,
    })
    return c.json({ success: true, data: result })
  } catch (err) {
    logError(err, { context: 'postPayment', paymentId: id })
    return c.json({ error: errMessage(err, 'Failed to post payment') }, 400)
  }
})

// POST /api/payments/:id/reverse — reverse a posted payment
//
// Guarded on `payments:update`, not `payments:delete`: a reversal is a
// non-destructive status change that posts its own reversing journal entry and
// leaves a full audit trail, and front-desk staff need it to undo a mis-keyed
// payment. Every reversal also lands on that day's daily report (see the
// 'reversals' digest provider in lib/digest.ts). The genuinely destructive
// paths — deleting a payment, voiding an invoice — still require
// `payments:delete`.
paymentsApp.post('/:id/reverse', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const parsed = reverseSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'reason is required' }, 400)
  const reason = parsed.data.reason

  try {
    const result = await reversePayment(db, id, { userId: user.id, reason })
    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: 'payments',
      entityId: id,
      entityName: `Payment ${result.payment.paymentNumber ?? id}`,
      before: { status: 'posted' },
      after: { status: 'reversed' },
      reason,
    })
    return c.json({ success: true, data: result })
  } catch (err) {
    logError(err, { context: 'reversePayment', paymentId: id })
    return c.json({ error: errMessage(err, 'Failed to reverse payment') }, 400)
  }
})

// POST /api/payments/:id/apply-credit — apply unallocated credit to an invoice
paymentsApp.post('/:id/apply-credit', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const parsed = applyCreditSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const result = await applyCreditToInvoice(db, id, body.invoiceId, body.amount, user.id)
    return c.json({ success: true, data: result })
  } catch (err) {
    logError(err, { context: 'applyCreditToInvoice', paymentId: id, invoiceId: body.invoiceId })
    return c.json({ error: errMessage(err, 'Failed to apply credit') }, 400)
  }
})

// GET /api/payments/:id/allocations — list allocations for a payment
paymentsApp.get('/:id/allocations', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.query.paymentAllocations.findMany({
    where: eq(paymentAllocations.paymentId, id),
    orderBy: [asc(paymentAllocations.allocatedAt)],
  })
  return c.json({ success: true, data: rows })
})

// POST /api/payments/refund — outgoing patient refund from deposit credit
paymentsApp.post('/refund', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const parsed = refundSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const result = await postRefund(
      db,
      {
        patientId: body.patientId,
        amount: body.amount,
        method: body.method as Parameters<typeof postRefund>[1]['method'],
        paymentDate: body.paymentDate ? new Date(body.paymentDate) : undefined,
        externalReference: body.externalReference ?? null,
        description: body.description ?? null,
      },
      user.id
    )
    return c.json({ success: true, data: result })
  } catch (err) {
    logError(err, { context: 'postRefund', patientId: body.patientId })
    return c.json({ error: errMessage(err, 'Failed to post refund') }, 400)
  }
})

// GET /api/payments/patient/:patientId/credit — unallocated credit available
paymentsApp.get('/patient/:patientId/credit', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { patientId } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const [bal] = await db
    .select()
    .from(patientBalances)
    .where(eq(patientBalances.patientId, patientId))
    .limit(1)
  return c.json({
    success: true,
    data: {
      depositBalance: bal?.depositBalance ?? 0,
      arBalance: bal?.arBalance ?? 0,
    },
  })
})

export { paymentsApp }
