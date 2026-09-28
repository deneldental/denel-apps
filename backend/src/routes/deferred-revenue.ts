import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { invoiceLines } from '../db/schema'
import { recordDiffAudit } from '../lib/audit'
import {
  listDeferredLines,
  listEventsForLine,
  recognizeRevenue,
} from '../lib/deferred-revenue-service'
import { errMessage } from '../lib/error-message'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const deferredRevenueApp = new Hono<HonoEnv>()

// Anchor under the existing FINANCIAL_RECORDS permission — deferred revenue
// is a sub-feature of accounting/reports rather than its own module.
const MODULE = MODULES.FINANCIAL_RECORDS

// ── L17: zod request schemas ────────────────────────────────────────────────
const recognizeSchema = z.object({
  amount: z.union([z.string(), z.number()]),
  trigger: z.enum(['manual', 'milestone', 'period_close']).optional(),
  milestoneRef: z.string().nullish(),
  notes: z.string().nullish(),
  entryDate: z.string().nullish(),
})

const deferFlagSchema = z.object({ deferRevenue: z.boolean() })

// GET /api/deferred-revenue — list every invoice_line flagged as deferred
//   ?outstandingOnly=true|false (default true)
//   ?invoiceId=<uuid> (optional filter)
deferredRevenueApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const outstandingOnly = c.req.query('outstandingOnly') !== 'false'
  const invoiceId = c.req.query('invoiceId') ?? undefined
  const rows = await listDeferredLines(db, { outstandingOnly, invoiceId })
  return c.json({ success: true, data: rows })
})

// GET /api/deferred-revenue/line/:invoiceLineId/events
deferredRevenueApp.get('/line/:invoiceLineId/events', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { invoiceLineId } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const events = await listEventsForLine(db, invoiceLineId)
  return c.json({ success: true, data: events })
})

// POST /api/deferred-revenue/line/:invoiceLineId/recognize
deferredRevenueApp.post('/line/:invoiceLineId/recognize', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { invoiceLineId } = c.req.param()
  const parsed = recognizeSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const result = await recognizeRevenue(
      db,
      {
        invoiceLineId,
        amount: body.amount,
        trigger: body.trigger ?? 'manual',
        milestoneRef: body.milestoneRef ?? null,
        notes: body.notes ?? null,
        entryDate: body.entryDate ? new Date(body.entryDate) : undefined,
      },
      user.id
    )
    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: MODULE as string,
      entityId: invoiceLineId,
      entityName: `Invoice line ${invoiceLineId.slice(0, 8)} recognition`,
      before: null,
      after: {
        amount: result.event.amount,
        journalEntryId: result.journalEntry.id,
        remaining: result.remainingDeferred,
      },
      reason: body.notes ?? null,
    })
    return c.json({ success: true, data: result })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to recognize revenue') }, 400)
  }
})

// PATCH /api/deferred-revenue/line/:invoiceLineId — flag/unflag a draft line
// as deferred. Only allowed while the parent invoice is draft.
deferredRevenueApp.patch('/line/:invoiceLineId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { invoiceLineId } = c.req.param()
  const parsed = deferFlagSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'deferRevenue boolean is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const line = await db.query.invoiceLines.findFirst({
    where: eq(invoiceLines.id, invoiceLineId),
    with: { invoice: true },
  })
  if (!line) return c.json({ error: 'Not found' }, 404)
  if (line.invoice?.status !== 'draft') {
    return c.json({ error: 'Defer flag can only change on draft invoices' }, 400)
  }
  const [updated] = await db
    .update(invoiceLines)
    .set({ deferRevenue: parsed.data.deferRevenue })
    .where(eq(invoiceLines.id, invoiceLineId))
    .returning()
  return c.json({ success: true, data: updated })
})

export { deferredRevenueApp }
