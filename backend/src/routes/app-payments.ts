import { formatCurrency } from '@denel/utils'
import { asc, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { appPaymentMethods, invoices, patients, paymentConfirmations } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import type { PaymentMethod } from '../lib/channel-accounts'
import { ACTIONS, MODULES } from '../lib/modules'
import { recordLegacyPayment } from '../lib/payment-service'
import { sendPushToPatients } from '../lib/push'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const MODULE = MODULES.PAYMENTS as string

// Map a patient-app payment-method type to a `payments.method` value.
function methodForType(type: string | null | undefined): PaymentMethod {
  switch (type) {
    case 'bank':
      return 'bank_transfer'
    case 'momo':
      return 'momo'
    case 'cash':
      return 'cash'
    default:
      return 'transfer'
  }
}

// ─── App payment methods config (admin) ──────────────────────────────────────
export const appPaymentMethodsApp = new Hono<HonoEnv>()

appPaymentMethodsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(appPaymentMethods)
    .orderBy(asc(appPaymentMethods.sortOrder), asc(appPaymentMethods.label))
  return c.json({ success: true, data: rows })
})

appPaymentMethodsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const body = (await c.req.json()) as Record<string, unknown>
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label) return c.json({ error: 'Label is required' }, 400)
  const [row] = await db
    .insert(appPaymentMethods)
    .values({
      label,
      type: typeof body.type === 'string' ? body.type : 'other',
      instructions: typeof body.instructions === 'string' ? body.instructions : null,
      isActive: body.isActive !== false,
      sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    })
    .returning()
  return c.json({ success: true, data: row })
})

appPaymentMethodsApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const body = (await c.req.json()) as Record<string, unknown>
  const update: Record<string, unknown> = { updatedAt: new Date() }
  if (typeof body.label === 'string') update.label = body.label.trim()
  if (typeof body.type === 'string') update.type = body.type
  if ('instructions' in body) update.instructions = body.instructions ?? null
  if (typeof body.isActive === 'boolean') update.isActive = body.isActive
  if (Number.isFinite(Number(body.sortOrder))) update.sortOrder = Number(body.sortOrder)
  const [row] = await db
    .update(appPaymentMethods)
    .set(update)
    .where(eq(appPaymentMethods.id, c.req.param('id')))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

appPaymentMethodsApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  await db.delete(appPaymentMethods).where(eq(appPaymentMethods.id, c.req.param('id')))
  return c.json({ success: true })
})

// ─── Payment confirmation requests (staff) ───────────────────────────────────
export const paymentConfirmationsApp = new Hono<HonoEnv>()

// GET /?status=pending — list confirmation requests with patient + invoice info.
paymentConfirmationsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const status = c.req.query('status') ?? 'pending'
  const rows = await db
    .select({
      id: paymentConfirmations.id,
      amount: paymentConfirmations.amount,
      reference: paymentConfirmations.reference,
      note: paymentConfirmations.note,
      methodLabel: paymentConfirmations.methodLabel,
      status: paymentConfirmations.status,
      createdAt: paymentConfirmations.createdAt,
      patientId: paymentConfirmations.patientId,
      patientName: patients.name,
      patientCode: patients.patientId,
      invoiceId: paymentConfirmations.invoiceId,
      invoiceNumber: invoices.invoiceNumber,
      invoiceBalance: invoices.balance,
    })
    .from(paymentConfirmations)
    .leftJoin(patients, eq(patients.id, paymentConfirmations.patientId))
    .leftJoin(invoices, eq(invoices.id, paymentConfirmations.invoiceId))
    .where(eq(paymentConfirmations.status, status))
    .orderBy(desc(paymentConfirmations.createdAt))
  return c.json({ success: true, data: rows })
})

// POST /:id/confirm — record the real payment (GL + allocation) and mark confirmed.
paymentConfirmationsApp.post('/:id/confirm', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  const [conf] = await db
    .select()
    .from(paymentConfirmations)
    .where(eq(paymentConfirmations.id, id))
    .limit(1)
  if (!conf) return c.json({ error: 'Request not found' }, 404)
  if (conf.status !== 'pending')
    return c.json({ error: 'This request has already been processed.' }, 409)

  // Resolve the payment method from the (possibly deleted) app method.
  let methodType: string | null = null
  if (conf.methodId) {
    const [m] = await db
      .select({ type: appPaymentMethods.type })
      .from(appPaymentMethods)
      .where(eq(appPaymentMethods.id, conf.methodId))
      .limit(1)
    methodType = m?.type ?? null
  }

  const { payment } = await recordLegacyPayment(
    db,
    {
      patientId: conf.patientId,
      amount: Number(conf.amount),
      method: methodForType(methodType),
      invoiceId: conf.invoiceId,
      externalReference: conf.reference ?? null,
      description: `Patient app payment${conf.methodLabel ? ` — ${conf.methodLabel}` : ''}`,
    },
    user.id
  )

  await db
    .update(paymentConfirmations)
    .set({
      status: 'confirmed',
      paymentId: payment.id,
      confirmedById: user.id,
      confirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(paymentConfirmations.id, id))

  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: user.id,
    action: 'update',
    module: 'payments',
    entityId: id,
    entityName: 'Patient app payment confirmation',
    changes: {
      before: { status: 'pending' },
      after: { status: 'confirmed', paymentId: payment.id },
    },
  })

  // Notify the patient their payment went through (best-effort — never let a
  // push failure break the confirmation).
  try {
    await sendPushToPatients([conf.patientId], {
      title: 'Payment confirmed',
      body: `Your payment of ${formatCurrency(Number(conf.amount))} has been received. Thank you!`,
      url: '/patient/payments',
    })
  } catch {
    // ignore push errors
  }

  return c.json({ success: true, data: { paymentId: payment.id } })
})

// POST /:id/reject — reject with a patient-visible reason.
paymentConfirmationsApp.post('/:id/reject', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string }
  const reason = (body.reason ?? '').trim()
  if (!reason) return c.json({ error: 'A reason is required.' }, 400)

  const [conf] = await db
    .select()
    .from(paymentConfirmations)
    .where(eq(paymentConfirmations.id, id))
    .limit(1)
  if (!conf) return c.json({ error: 'Request not found' }, 404)
  if (conf.status !== 'pending')
    return c.json({ error: 'This request has already been processed.' }, 409)

  await db
    .update(paymentConfirmations)
    .set({
      status: 'rejected',
      rejectionReason: reason,
      confirmedById: user.id,
      confirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(paymentConfirmations.id, id))

  // Notify the patient, surfacing the reason so they can act on it (best-effort).
  try {
    await sendPushToPatients([conf.patientId], {
      title: 'Payment not confirmed',
      body: reason,
      url: '/patient/payments',
    })
  } catch {
    // ignore push errors
  }

  return c.json({ success: true })
})
