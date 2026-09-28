/**
 * Tax Calculations — Phase H3.4 (Ghana GRA)
 *
 * - POST /api/tax-calculations/compute — pure calc (no DB write)
 * - POST /api/tax-calculations/save    — compute + persist snapshot
 * - GET  /api/tax-calculations         — list recent calcs (filters: sourceType, patientId)
 * - GET  /api/tax-calculations/:id     — single snapshot
 * - DELETE /api/tax-calculations/:id   — admin-only
 */

import { computeGhanaTax, Money } from '@denel/utils'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { taxCalculations } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { getTaxRates } from '../lib/tax-config'
import type { HonoEnv } from '../lib/types'

const taxCalculationsApp = new Hono<HonoEnv>()

type ComputeBody = {
  baseAmount: number
  applyVAT?: boolean
  applyNHIL?: boolean
  applyGETFund?: boolean
}

function parseBody(body: any): { ok: true; input: ComputeBody } | { ok: false; error: string } {
  const amt = Number(body.baseAmount)
  if (!Number.isFinite(amt) || amt < 0)
    return { ok: false, error: 'baseAmount must be a non-negative number' }
  return {
    ok: true,
    input: {
      baseAmount: amt,
      applyVAT: body.applyVAT !== false,
      applyNHIL: body.applyNHIL !== false,
      applyGETFund: body.applyGETFund !== false,
    },
  }
}

// POST /compute — pure calculator, no persistence
/**
 * `computeGhanaTax` works in CEDIS; the API and the `tax_calculations` columns
 * are integer CENTS. Convert every money leg, leaving the `effectiveRate`
 * ratio and the legacy aliases' shape intact.
 */
function toCentsBreakdown(b: ReturnType<typeof computeGhanaTax>) {
  const c = (v: number) => Money.fromNumber(v).toDbValue()
  return {
    ...b,
    baseAmount: c(b.baseAmount),
    nhilAmount: c(b.nhilAmount),
    getfundAmount: c(b.getfundAmount),
    levyBase: c(b.levyBase),
    vatAmount: c(b.vatAmount),
    totalTax: c(b.totalTax),
    grossTotal: c(b.grossTotal),
    // The two legacy aliases carry money too — leaving them in cedis would ship
    // a payload where `levyBase` and `vatableAmount` disagree by 100x.
    vatableAmount: c(b.vatableAmount),
    totalAmount: c(b.totalAmount),
  }
}

taxCalculationsApp.post('/compute', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.TAX_CALCULATIONS as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const parsed = parseBody(await c.req.json())
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  // D6: rates come from the `tax_rates` clinic setting, not hard-coded constants.
  const db = getDb(process.env.DATABASE_URL!)
  const rates = await getTaxRates(db)
  // UNIT BOUNDARY: the request body and the `tax_calculations` money columns
  // are integer CENTS (migration 0209), but `computeGhanaTax` works in CEDIS.
  // Convert on the way in, and convert every money leg back on the way out so
  // the response speaks the same unit as the rest of the API. `effectiveRate`
  // is a ratio and stays as-is.
  const breakdown = computeGhanaTax(Money.fromDb(parsed.input.baseAmount).toNumber(), {
    applyVAT: parsed.input.applyVAT,
    applyNHIL: parsed.input.applyNHIL,
    applyGETFund: parsed.input.applyGETFund,
    rates,
  })

  return c.json({
    success: true,
    data: {
      ...toCentsBreakdown(breakdown),
      rates,
      inputs: parsed.input,
    },
  })
})

// POST /save — compute + persist
taxCalculationsApp.post('/save', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      user.id,
      MODULES.TAX_CALCULATIONS as string,
      ACTIONS.CREATE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  const parsed = parseBody(body)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  // D6: rates come from the `tax_rates` clinic setting, not hard-coded constants.
  const rates = await getTaxRates(db)
  // Same cents <-> cedis boundary as /compute above.
  const breakdown = computeGhanaTax(Money.fromDb(parsed.input.baseAmount).toNumber(), {
    applyVAT: parsed.input.applyVAT,
    applyNHIL: parsed.input.applyNHIL,
    applyGETFund: parsed.input.applyGETFund,
    rates,
  })
  const stored = toCentsBreakdown(breakdown)

  try {
    const [row] = await db
      .insert(taxCalculations)
      .values({
        sourceType: body.sourceType ?? 'standalone',
        sourceId: body.sourceId ?? null,
        patientId: body.patientId ?? null,
        baseAmount: stored.baseAmount,
        applyVAT: parsed.input.applyVAT ?? true,
        applyNHIL: parsed.input.applyNHIL ?? true,
        applyGETFund: parsed.input.applyGETFund ?? true,
        nhilAmount: stored.nhilAmount,
        getfundAmount: stored.getfundAmount,
        levyBase: stored.levyBase,
        vatAmount: stored.vatAmount,
        totalTax: stored.totalTax,
        grossTotal: stored.grossTotal,
        effectiveRate: breakdown.effectiveRate,
        ratesSnapshot: rates,
        notes: body.notes ?? null,
        createdById: user.id,
      })
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'tax_calculations',
      entityId: row.id,
      entityName: `Tax calc: GHS ${breakdown.baseAmount.toFixed(2)} → GHS ${breakdown.grossTotal.toFixed(2)}`,
      changes: { input: parsed.input, output: breakdown },
    })

    return c.json({ success: true, data: row })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// GET / — list with filters
taxCalculationsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.TAX_CALCULATIONS as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const patientId = c.req.query('patientId')
  const sourceType = c.req.query('sourceType')

  const conditions: any[] = []
  if (patientId) conditions.push(eq(taxCalculations.patientId, patientId))
  if (sourceType) conditions.push(eq(taxCalculations.sourceType, sourceType))

  const rows = await db
    .select()
    .from(taxCalculations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(taxCalculations.createdAt))
    .limit(500)

  return c.json({ success: true, data: rows })
})

// GET /:id — single snapshot
taxCalculationsApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.TAX_CALCULATIONS as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .select()
    .from(taxCalculations)
    .where(eq(taxCalculations.id, c.req.param('id')))
    .limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

// DELETE /:id — admin-only (tax records are normally kept for compliance)
taxCalculationsApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      user.id,
      MODULES.TAX_CALCULATIONS as string,
      ACTIONS.DELETE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .delete(taxCalculations)
    .where(eq(taxCalculations.id, c.req.param('id')))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

export { taxCalculationsApp }
