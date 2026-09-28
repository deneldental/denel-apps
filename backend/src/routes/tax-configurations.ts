/**
 * Tax Configuration registry — admin-v1 F1.
 *
 * Single source of truth for GRA rates (VAT/NHIL/GETFund/WHT/CIT) the calc
 * engines read at runtime. Excludes PAYE/SSNIT — those live in
 * payroll_tax_brackets (§14.3). History is preserved: creating a new rate for a
 * taxType supersedes the prior active row (sets effectiveTo + isActive=false)
 * rather than overwriting it.
 */

import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { taxConfigurations } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

export const taxConfigurationsApp = new Hono<HonoEnv>()

const MODULE = MODULES.SETTINGS

const VALID_TAX_TYPES = new Set([
  'VAT',
  'NHIL',
  'GETFund',
  'WHT_Services',
  'WHT_Insurance',
  'CIT_Rate',
])
const VALID_APPLICABLE = new Set(['income', 'expenses', 'contractors'])

// GET / — every rate, active first then history (by taxType, newest effectiveFrom).
taxConfigurationsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db
      .select()
      .from(taxConfigurations)
      .orderBy(
        desc(taxConfigurations.isActive),
        taxConfigurations.taxType,
        desc(taxConfigurations.effectiveFrom)
      )
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: '[tax-configurations] list' })
    return c.json({ error: 'Failed to fetch tax configurations' }, 500)
  }
})

// POST / — set a rate. Supersedes the current active row of the same taxType so
// the rate timeline is preserved (no destructive edits).
taxConfigurationsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    taxType?: string
    rate?: number | string
    applicableTo?: string
    effectiveFrom?: string
    notes?: string | null
  }
  const taxType = String(body.taxType ?? '')
  if (!VALID_TAX_TYPES.has(taxType)) return c.json({ error: 'Invalid taxType' }, 400)
  const rate = Number(body.rate)
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    return c.json({ error: 'rate must be a fraction between 0 and 1 (e.g. 0.15 for 15%)' }, 400)
  }
  const applicableTo = VALID_APPLICABLE.has(String(body.applicableTo))
    ? (body.applicableTo as string)
    : 'income'

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const now = new Date()
    const row = await db.transaction(async (tx) => {
      await tx
        .update(taxConfigurations)
        .set({ isActive: false, effectiveTo: now, updatedAt: now })
        .where(and(eq(taxConfigurations.taxType, taxType), eq(taxConfigurations.isActive, true)))
      const [created] = await tx
        .insert(taxConfigurations)
        .values({
          taxType,
          rate,
          applicableTo,
          effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : now,
          notes: body.notes ?? null,
          isActive: true,
          createdById: user.id,
        })
        .returning()
      return created
    })

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'settings',
      entityId: row.id,
      entityName: `Tax rate: ${taxType} ${(rate * 100).toFixed(2)}%`,
      changes: { taxType, rate, applicableTo },
    })
    // The rich log above replaces the generic auto-log from auditMiddleware.
    c.set('skipAudit', true)
    return c.json({ success: true, data: row })
  } catch (error: unknown) {
    logError(error, { context: '[tax-configurations] create' })
    return c.json({ error: 'Failed to create tax configuration' }, 500)
  }
})

// PATCH /:id — correct notes / applicableTo on an existing row (rate changes go
// through POST so history is preserved).
taxConfigurationsApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as {
    applicableTo?: string
    notes?: string | null
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body.applicableTo !== undefined) {
    if (!VALID_APPLICABLE.has(String(body.applicableTo)))
      return c.json({ error: 'Invalid applicableTo' }, 400)
    updates.applicableTo = body.applicableTo
  }
  if (body.notes !== undefined) updates.notes = body.notes

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [row] = await db
      .update(taxConfigurations)
      .set(updates)
      .where(eq(taxConfigurations.id, id))
      .returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: row })
  } catch (error: unknown) {
    logError(error, { context: '[tax-configurations] update' })
    return c.json({ error: 'Failed to update tax configuration' }, 500)
  }
})
