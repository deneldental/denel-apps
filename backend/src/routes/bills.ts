import { and, asc, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { billLines, bills, supplierBalances } from '../db/schema'
import {
  type CreateBillInput,
  computeBillLine,
  createDraftBill,
  postBill,
  voidBill,
} from '../lib/ap-service'
import { recordDiffAudit } from '../lib/audit'
import { errMessage } from '../lib/error-message'
import { ACTIONS, MODULES } from '../lib/modules'
import { postSupplierPayment } from '../lib/payment-service'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const billsApp = new Hono<HonoEnv>()
const MODULE = MODULES.BILLS

// ── L17: zod request schemas — every mutation body is validated up front ────
const billLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.union([z.string(), z.number()]).optional(),
  unitPrice: z.union([z.string(), z.number()]),
  taxRate: z.union([z.string(), z.number()]).optional(),
  expenseAccountId: z.string().uuid(),
})

const createBillSchema = z.object({
  supplierId: z.string().uuid(),
  supplierBillRef: z.string().nullish(),
  issueDate: z.string().nullish(),
  dueDate: z.string().nullish(),
  notes: z.string().nullish(),
  lines: z.array(billLineSchema).min(1),
})

const voidSchema = z.object({ reason: z.string().min(1) })

const paySchema = z.object({
  amount: z.union([z.string(), z.number()]),
  method: z.string().min(1),
  paymentDate: z.string().nullish(),
  externalReference: z.string().nullish(),
  description: z.string().nullish(),
})

// GET /api/bills — list (filter by status, supplierId)
billsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const status = c.req.query('status')
  const supplierId = c.req.query('supplierId')
  const where = []
  if (status) where.push(eq(bills.status, status))
  if (supplierId) where.push(eq(bills.supplierId, supplierId))

  const rows = await db.query.bills.findMany({
    where: where.length === 0 ? undefined : where.length === 1 ? where[0] : and(...where),
    with: { supplier: true },
    orderBy: [desc(bills.issueDate), desc(bills.createdAt)],
  })
  return c.json({ success: true, data: rows })
})

// GET /api/bills/:id — single bill with lines
billsApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const bill = await db.query.bills.findFirst({
    where: eq(bills.id, id),
    with: { supplier: true },
  })
  if (!bill) return c.json({ error: 'Not found' }, 404)
  const lines = await db.query.billLines.findMany({
    where: eq(billLines.billId, id),
    with: { expenseAccount: true },
    orderBy: [asc(billLines.id)],
  })
  return c.json({ success: true, data: { ...bill, lines } })
})

// POST /api/bills — create a draft bill with lines
billsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const parsed = createBillSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const input: CreateBillInput = {
      supplierId: body.supplierId,
      supplierBillRef: body.supplierBillRef ?? null,
      issueDate: body.issueDate ? new Date(body.issueDate) : undefined,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      notes: body.notes ?? null,
      lines: body.lines,
    }
    const bill = await createDraftBill(db, input, user.id)
    return c.json({ success: true, data: bill })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to draft bill') }, 400)
  }
})

// POST /api/bills/:id/post — post a draft bill (writes JE, bumps AP)
billsApp.post('/:id/post', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const result = await postBill(db, id, user.id)
    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: MODULE as string,
      entityId: id,
      entityName: `Bill ${result.bill.billNumber}`,
      before: { status: 'draft' },
      after: {
        status: result.bill.status,
        journalEntryId: result.journalEntry.id,
      },
      reason: null,
    })
    return c.json({ success: true, data: result })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to post bill') }, 400)
  }
})

// POST /api/bills/:id/void — reverse a posted bill (no payments allocated)
billsApp.post('/:id/void', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const parsed = voidSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'reason is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const result = await voidBill(db, id, { userId: user.id, reason: parsed.data.reason })
    return c.json({ success: true, data: result })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to void bill') }, 400)
  }
})

// POST /api/bills/:id/pay — record a payment against a posted bill
billsApp.post('/:id/pay', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const { id } = c.req.param()
  const parsed = paySchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const db = getDb(process.env.DATABASE_URL!)
  const bill = await db.query.bills.findFirst({ where: eq(bills.id, id) })
  if (!bill) return c.json({ error: 'Bill not found' }, 404)
  if (bill.status !== 'posted' && bill.status !== 'partially_paid') {
    return c.json({ error: 'Bill is not open' }, 400)
  }

  try {
    const result = await postSupplierPayment(
      db,
      {
        supplierId: bill.supplierId,
        billId: bill.id,
        amount: body.amount,
        method: body.method as Parameters<typeof postSupplierPayment>[1]['method'],
        paymentDate: body.paymentDate ? new Date(body.paymentDate) : undefined,
        externalReference: body.externalReference ?? null,
        description: body.description ?? null,
      },
      user.id
    )
    return c.json({ success: true, data: result })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to record bill payment') }, 400)
  }
})

// POST /api/bills/preview-line — math helper for the composer UI
billsApp.post('/preview-line', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  // L17: this endpoint was missing its permission check — gate it on the same
  // READ permission as the rest of the bills routes.
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const parsed = billLineSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  return c.json({ success: true, data: computeBillLine(parsed.data) })
})

// GET /api/bills/supplier/:supplierId/balance — AP balance for one supplier
billsApp.get('/supplier/:supplierId/balance', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { supplierId } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .select()
    .from(supplierBalances)
    .where(eq(supplierBalances.supplierId, supplierId))
    .limit(1)
  return c.json({ success: true, data: { apBalance: row?.apBalance ?? 0 } })
})

export { billsApp }
