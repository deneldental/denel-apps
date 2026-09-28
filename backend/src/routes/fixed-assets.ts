/**
 * fixed-assets.ts — admin-v1 §4.F6 (Fixed Asset Register).
 *
 * CRUD for fixed_assets + prepaid_assets, plus the two GL actions:
 *   POST /:id/generate-schedule   → lay out the straight-line monthly schedule
 *   POST /:id/post-depreciation   → post ONE schedule period to the GL
 *   POST /prepaid/:id/amortize    → post ONE prepaid monthly slice to the GL
 *
 * Permissions ride the finance/GL bundle (MODULES.ACCOUNTS) — the same module that
 * gates the chart of accounts and journal entries, which is exactly who manages the
 * asset register. The GL services keep the books balanced + idempotent.
 */

import { and, asc, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { depreciationSchedules, fixedAssets, prepaidAssets } from '../db/schema'
import {
  disposeAsset,
  generateDepreciationSchedule,
  postDepreciationForPeriod,
  postPrepaidAmortization,
} from '../lib/fixed-asset-service'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const fixedAssetsApp = new Hono<HonoEnv>()

const MODULE = MODULES.ACCOUNTS

async function authorize(c: Parameters<typeof getCurrentUser>[0], action: string) {
  const user = await getCurrentUser(c)
  if (!user) return { error: c.json({ error: 'Not authenticated' }, 401) }
  if (!(await checkPermission(c, user.id, MODULE as string, action)))
    return { error: c.json({ error: 'Unauthorized' }, 403) }
  return { user }
}

const fixedAssetSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  acquisitionCost: z.coerce.number().positive(),
  acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)'),
  usefulLifeMonths: z.coerce.number().int().positive(),
  salvageValue: z.coerce.number().nonnegative().optional(),
  depreciationMethod: z.string().optional(),
  assetAccountId: z.string().uuid().optional().nullable(),
  expenseAccountId: z.string().uuid().optional().nullable(),
  accumDepAccountId: z.string().uuid().optional().nullable(),
})

const prepaidSchema = z.object({
  name: z.string().min(1),
  // Money is integer CENTS (migration 0209); a fractional value here reached
  // Postgres and came back as an opaque 500.
  totalAmount: z.coerce.number().int().positive(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)'),
  months: z.coerce.number().int().positive(),
  monthlyAmount: z.coerce.number().int().positive().optional(),
  prepaidAccountId: z.string().uuid().optional().nullable(),
  expenseAccountId: z.string().uuid().optional().nullable(),
})

// ── Fixed assets ──────────────────────────────────────────────────────────────

fixedAssetsApp.get('/', async (c) => {
  const auth = await authorize(c, ACTIONS.READ as string)
  if (auth.error) return auth.error
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const data = await db.select().from(fixedAssets).orderBy(desc(fixedAssets.createdAt))
    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { context: 'list fixed assets' })
    return c.json({ error: 'Failed to fetch fixed assets' }, 500)
  }
})

fixedAssetsApp.get('/prepaid', async (c) => {
  const auth = await authorize(c, ACTIONS.READ as string)
  if (auth.error) return auth.error
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const data = await db.select().from(prepaidAssets).orderBy(desc(prepaidAssets.createdAt))
    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { context: 'list prepaid assets' })
    return c.json({ error: 'Failed to fetch prepaid assets' }, 500)
  }
})

fixedAssetsApp.post('/prepaid', async (c) => {
  const auth = await authorize(c, ACTIONS.CREATE as string)
  if (auth.error) return auth.error
  const parsed = prepaidSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const p = parsed.data
    // FLOOR, not round: `postPrepaidAmortization` gives the final month
    // `total - monthly * (months - 1)`, so any remainder is absorbed there and
    // the slices sum to the total exactly. Rounding up would make that last
    // slice smaller than the rest — and, for a small total, negative. The old
    // `.toFixed(2)` produced a FRACTIONAL cent (10000 / 3 -> 3333.33) for an
    // integer column.
    const monthlyAmount = p.monthlyAmount ?? Math.floor(p.totalAmount / p.months)
    const [row] = await db
      .insert(prepaidAssets)
      .values({
        name: p.name,
        totalAmount: p.totalAmount,
        startDate: p.startDate,
        months: p.months,
        monthlyAmount,
        prepaidAccountId: p.prepaidAccountId ?? null,
        expenseAccountId: p.expenseAccountId ?? null,
        createdById: auth.user.id,
      })
      .returning()
    return c.json({ success: true, data: row })
  } catch (error) {
    logError(error, { context: 'create prepaid asset' })
    return c.json({ error: 'Failed to create prepaid asset' }, 500)
  }
})

// Post ONE prepaid monthly slice to the GL (DR Expense / CR Prepaid).
fixedAssetsApp.post('/prepaid/:id/amortize', async (c) => {
  const auth = await authorize(c, ACTIONS.UPDATE as string)
  if (auth.error) return auth.error
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { periodDate?: string }
  const periodDate = body.periodDate ? new Date(body.periodDate) : new Date()
  if (Number.isNaN(periodDate.getTime())) return c.json({ error: 'Invalid periodDate' }, 400)
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const result = await postPrepaidAmortization(db, id, periodDate, auth.user.id)
    // success = "request handled"; the outcome (posted + reason/entryId) rides in
    // `data` so the FE can distinguish a real post from a benign no-op replay
    // (already_posted / closed_period / out_of_window) — those are NOT failures.
    return c.json({ success: true, data: result })
  } catch (error) {
    logError(error, { context: 'post prepaid amortization' })
    return c.json({ error: 'Failed to post amortization' }, 500)
  }
})

fixedAssetsApp.get('/:id', async (c) => {
  const auth = await authorize(c, ACTIONS.READ as string)
  if (auth.error) return auth.error
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const id = c.req.param('id')
    const [asset] = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id)).limit(1)
    if (!asset) return c.json({ error: 'Not found' }, 404)
    const schedules = await db
      .select()
      .from(depreciationSchedules)
      .where(eq(depreciationSchedules.fixedAssetId, id))
      .orderBy(asc(depreciationSchedules.periodDate))
    return c.json({ success: true, data: { ...asset, schedules } })
  } catch (error) {
    logError(error, { context: 'get fixed asset' })
    return c.json({ error: 'Failed to fetch fixed asset' }, 500)
  }
})

fixedAssetsApp.post('/', async (c) => {
  const auth = await authorize(c, ACTIONS.CREATE as string)
  if (auth.error) return auth.error
  const parsed = fixedAssetSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const a = parsed.data
    if (a.salvageValue != null && a.salvageValue > a.acquisitionCost) {
      return c.json({ error: 'salvageValue cannot exceed acquisitionCost' }, 400)
    }
    const [row] = await db
      .insert(fixedAssets)
      .values({
        name: a.name,
        category: a.category ?? null,
        acquisitionCost: a.acquisitionCost,
        acquisitionDate: a.acquisitionDate,
        usefulLifeMonths: a.usefulLifeMonths,
        salvageValue: a.salvageValue ?? 0,
        depreciationMethod: a.depreciationMethod ?? 'straight_line',
        assetAccountId: a.assetAccountId ?? null,
        expenseAccountId: a.expenseAccountId ?? null,
        accumDepAccountId: a.accumDepAccountId ?? null,
        createdById: auth.user.id,
      })
      .returning()
    return c.json({ success: true, data: row })
  } catch (error) {
    logError(error, { context: 'create fixed asset' })
    return c.json({ error: 'Failed to create fixed asset' }, 500)
  }
})

fixedAssetsApp.delete('/:id', async (c) => {
  const auth = await authorize(c, ACTIONS.DELETE as string)
  if (auth.error) return auth.error
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const id = c.req.param('id')
    // Block deleting an asset that has any posted depreciation — the GL would be
    // left referencing schedules that no longer exist.
    const posted = await db.query.depreciationSchedules.findFirst({
      where: and(
        eq(depreciationSchedules.fixedAssetId, id),
        eq(depreciationSchedules.posted, true)
      ),
      columns: { posted: true },
    })
    if (posted?.posted) {
      return c.json({ error: 'Asset has posted depreciation — reverse it before deleting.' }, 409)
    }
    const [removed] = await db.delete(fixedAssets).where(eq(fixedAssets.id, id)).returning()
    if (!removed) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true })
  } catch (error) {
    logError(error, { context: 'delete fixed asset' })
    return c.json({ error: 'Failed to delete fixed asset' }, 500)
  }
})

// Generate (idempotently) the straight-line monthly schedule for an asset.
fixedAssetsApp.post('/:id/generate-schedule', async (c) => {
  const auth = await authorize(c, ACTIONS.UPDATE as string)
  if (auth.error) return auth.error
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const id = c.req.param('id')
    const schedules = await generateDepreciationSchedule(db, id)
    return c.json({ success: true, data: schedules, count: schedules.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate schedule'
    logError(error, { context: 'generate depreciation schedule' })
    return c.json({ error: message }, 400)
  }
})

// Post ONE depreciation period to the GL (DR Dep Expense / CR Accum Dep).
fixedAssetsApp.post('/:id/post-depreciation', async (c) => {
  const auth = await authorize(c, ACTIONS.UPDATE as string)
  if (auth.error) return auth.error
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { scheduleId?: string }
  if (!body.scheduleId) return c.json({ error: 'scheduleId is required' }, 400)
  try {
    const db = getDb(process.env.DATABASE_URL!)
    // The scheduleId must belong to the asset in the path.
    const row = await db.query.depreciationSchedules.findFirst({
      where: eq(depreciationSchedules.id, body.scheduleId),
      columns: { fixedAssetId: true },
    })
    if (!row || row.fixedAssetId !== id) {
      return c.json({ error: 'Schedule does not belong to this asset' }, 404)
    }
    const result = await postDepreciationForPeriod(db, body.scheduleId, auth.user.id)
    // success = "request handled"; the outcome (posted + reason/entryId) rides in
    // `data` so the FE can distinguish a real post from a benign no-op replay
    // (already_posted / closed_period / out_of_window) — those are NOT failures.
    return c.json({ success: true, data: result })
  } catch (error) {
    logError(error, { context: 'post depreciation' })
    return c.json({ error: 'Failed to post depreciation' }, 500)
  }
})

// Dispose a fixed asset — sets status='disposed', posts GL gain/loss entry.
fixedAssetsApp.post('/:id/dispose', async (c) => {
  const auth = await authorize(c, ACTIONS.UPDATE as string)
  if (auth.error) return auth.error
  const id = c.req.param('id')
  const disposeSchema = z.object({
    disposalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    proceeds: z.coerce.number().nonnegative().optional(),
  })
  const parsed = disposeSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const result = await disposeAsset(db, id, {
      disposalDate: parsed.data.disposalDate,
      proceeds: parsed.data.proceeds,
      createdBy: auth.user.id,
    })
    if (!result.disposed) {
      if (result.reason === 'not_found') return c.json({ error: 'Asset not found' }, 404)
      if (result.reason === 'already_disposed')
        return c.json({ error: 'Asset already disposed' }, 409)
      return c.json({ error: 'Accounting period is closed — open the period and retry' }, 422)
    }
    return c.json({ success: true })
  } catch (error) {
    logError(error, { context: 'dispose fixed asset' })
    return c.json({ error: 'Failed to dispose asset' }, 500)
  }
})

export { fixedAssetsApp }
