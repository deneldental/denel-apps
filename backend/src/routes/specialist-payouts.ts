import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { specialistBalances, specialistCommissions, specialistPayouts } from '../db/schema'
import { recordDiffAudit } from '../lib/audit'
import { createPayout, postPayout } from '../lib/commission-service'
import { errMessage } from '../lib/error-message'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const specialistPayoutsApp = new Hono<HonoEnv>()
const MODULE = MODULES.COMMISSIONS

// ── L17: zod request schemas ────────────────────────────────────────────────
const createPayoutSchema = z.object({
  specialistId: z.string().uuid(),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
})

const postPayoutSchema = z.object({
  method: z.string().min(1),
  paymentDate: z.string().nullish(),
  externalReference: z.string().nullish(),
})

// GET /api/specialist-payouts — list (filter by status, specialistId)
specialistPayoutsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const status = c.req.query('status')
  const specialistId = c.req.query('specialistId')
  const where = []
  if (status) where.push(eq(specialistPayouts.status, status))
  if (specialistId) where.push(eq(specialistPayouts.specialistId, specialistId))

  const rows = await db.query.specialistPayouts.findMany({
    where: where.length === 0 ? undefined : where.length === 1 ? where[0] : and(...where),
    with: { specialist: true },
    orderBy: [desc(specialistPayouts.createdAt)],
  })
  return c.json({ success: true, data: rows })
})

// GET /api/specialist-payouts/:id
specialistPayoutsApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const payout = await db.query.specialistPayouts.findFirst({
    where: eq(specialistPayouts.id, id),
    with: { specialist: true, commissions: true },
  })
  if (!payout) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: payout })
})

// POST /api/specialist-payouts — create a draft payout bundle
specialistPayoutsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const parsed = createPayoutSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const payout = await createPayout(
      db,
      {
        specialistId: body.specialistId,
        periodStart: new Date(body.periodStart),
        periodEnd: new Date(body.periodEnd),
      },
      user.id
    )
    return c.json({ success: true, data: payout })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to create payout') }, 400)
  }
})

// POST /api/specialist-payouts/:id/post — post the JE + record outgoing payment
specialistPayoutsApp.post('/:id/post', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const parsed = postPayoutSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const result = await postPayout(db, id, {
      userId: user.id,
      method: body.method as Parameters<typeof postPayout>[2]['method'],
      paymentDate: body.paymentDate ? new Date(body.paymentDate) : undefined,
      externalReference: body.externalReference ?? null,
    })
    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: MODULE as string,
      entityId: id,
      entityName: `Payout ${result.payout.payoutNumber}`,
      before: { status: 'draft' },
      after: {
        status: result.payout.status,
        journalEntryId: result.journalEntry.id,
      },
      reason: null,
    })
    return c.json({ success: true, data: result })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to post payout') }, 400)
  }
})

// GET /api/specialist-payouts/specialist/:id/commissions — commissions for a specialist
specialistPayoutsApp.get('/specialist/:id/commissions', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const status = c.req.query('status')
  const from = c.req.query('from')
  const to = c.req.query('to')

  const db = getDb(process.env.DATABASE_URL!)
  const where = [eq(specialistCommissions.specialistId, id)]
  if (status) where.push(eq(specialistCommissions.status, status))
  if (from) where.push(gte(specialistCommissions.accruedAt, new Date(from)))
  if (to) where.push(lte(specialistCommissions.accruedAt, new Date(`${to}T23:59:59.999Z`)))

  const rows = await db.query.specialistCommissions.findMany({
    where: where.length === 1 ? where[0] : and(...where),
    with: { invoice: { columns: { id: true, invoiceNumber: true, total: true, balance: true } } },
    orderBy: [desc(specialistCommissions.accruedAt)],
  })
  return c.json({ success: true, data: rows })
})

// GET /api/specialist-payouts/specialist/:id/balance
specialistPayoutsApp.get('/specialist/:id/balance', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .select()
    .from(specialistBalances)
    .where(eq(specialistBalances.specialistId, id))
    .limit(1)
  return c.json({
    success: true,
    data: row ?? { specialistId: id, accruedAmount: 0, payableAmount: 0, paidAmount: 0 },
  })
})

export { specialistPayoutsApp }
