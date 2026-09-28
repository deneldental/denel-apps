/**
 * Insurance claims (P4) — lifecycle CRUD on the existing insurance_claims table
 * (pending → submitted → approved/denied → paid).
 *
 * Gating: a claim can only be SUBMITTED once the insurer's effective price list
 * has no rows still pending approval — i.e. every insurer service is linked to
 * one of ours. This is the "approve before claims can be submitted" rule.
 *
 * Mounted under /api/insurance (app.ts).
 */
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  insuranceClaimLines,
  insuranceClaims,
  insuranceCompanies,
  insurancePriceListItems,
  insurancePriceLists,
  patients,
} from '../db/schema'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

export const insuranceClaimsApp = new Hono<HonoEnv>()
const MODULE = MODULES.INSURANCE

function makeClaimNumber(): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  // Year is derived from the request time; fine for a human-facing ref.
  return `CLM-${new Date().getFullYear()}-${rand}`
}

// ── GET /claims ───────────────────────────────────────────────────────────────
insuranceClaimsApp.get('/claims', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const companyId = c.req.query('companyId')
  const status = c.req.query('status')
  const db = getDb(process.env.DATABASE_URL!)

  const conds = []
  if (companyId) conds.push(eq(insuranceClaims.companyId, companyId))
  if (status) conds.push(eq(insuranceClaims.status, status))

  const rows = await db
    .select({
      id: insuranceClaims.id,
      companyId: insuranceClaims.companyId,
      companyName: insuranceCompanies.name,
      patientId: insuranceClaims.patientId,
      patientName: patients.name,
      claimNumber: insuranceClaims.claimNumber,
      chargedAmount: insuranceClaims.chargedAmount,
      approvedAmount: insuranceClaims.approvedAmount,
      paidAmount: insuranceClaims.paidAmount,
      status: insuranceClaims.status,
      denialReason: insuranceClaims.denialReason,
      submittedAt: insuranceClaims.submittedAt,
      approvedAt: insuranceClaims.approvedAt,
      paidAt: insuranceClaims.paidAt,
      notes: insuranceClaims.notes,
      createdAt: insuranceClaims.createdAt,
    })
    .from(insuranceClaims)
    .leftJoin(insuranceCompanies, eq(insuranceClaims.companyId, insuranceCompanies.id))
    .leftJoin(patients, eq(insuranceClaims.patientId, patients.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(insuranceClaims.createdAt))
    .limit(500)

  return c.json({ success: true, data: rows })
})

// ── POST /claims — create (status 'pending') ──────────────────────────────────
insuranceClaimsApp.post('/claims', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.CREATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    companyId?: string
    patientId?: string
    chargedAmount?: number
    reconciliationId?: string
    notes?: string
    /**
     * Optional per-treatment breakdown (reception insurance flow). When present,
     * `chargedAmount` is IGNORED and recomputed from the covered lines — the
     * client must not get to decide what the insurer owes.
     */
    lines?: Array<{
      serviceId?: string | null
      treatmentTypeId?: string | null
      description?: string
      clinicPrice?: number | string
      insurerPrice?: number | string
      covered?: boolean
    }>
  }
  if (!body.companyId || !body.patientId)
    return c.json({ error: 'companyId and patientId are required' }, 400)

  const num = (v: unknown): number => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }

  const lines = (body.lines ?? [])
    .filter((l) => (l?.description ?? '').trim().length > 0)
    .map((l, i) => ({
      serviceId: l.serviceId ?? null,
      treatmentTypeId: l.treatmentTypeId ?? null,
      description: (l.description as string).trim(),
      clinicPrice: num(l.clinicPrice),
      // An uncovered line contributes nothing to the insurer, whatever the
      // client sent — the patient owes its clinic price instead.
      insurerPrice: l.covered === false ? 0 : num(l.insurerPrice),
      covered: l.covered !== false,
      lineNumber: i + 1,
    }))

  // Server-side total. With lines, the insurer is owed the covered prices only.
  const chargedAmount = lines.length
    ? lines.reduce((sum, l) => sum + (l.covered ? l.insurerPrice : 0), 0)
    : body.chargedAmount
  if (chargedAmount == null)
    return c.json({ error: 'chargedAmount is required when no lines are supplied' }, 400)
  if (lines.length > 0 && chargedAmount <= 0)
    return c.json(
      { error: 'No treatment on this claim is covered by the insurer — nothing to claim' },
      400
    )

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const created = await db.transaction(async (tx) => {
      const [claim] = await tx
        .insert(insuranceClaims)
        .values({
          companyId: body.companyId as string,
          patientId: body.patientId as string,
          chargedAmount,
          reconciliationId: body.reconciliationId ?? null,
          notes: body.notes ?? null,
          status: 'pending',
          createdById: user.id,
        })
        .returning()

      if (lines.length > 0) {
        await tx.insert(insuranceClaimLines).values(lines.map((l) => ({ ...l, claimId: claim.id })))
      }
      return claim
    })
    return c.json({ success: true, data: { ...created, lineCount: lines.length } }, 201)
  } catch (error) {
    logError(error, { context: 'Claim create' })
    return c.json({ error: 'Failed to create claim' }, 500)
  }
})

// ── GET /claims/:id/lines — the per-treatment breakdown ───────────────────────
insuranceClaimsApp.get('/claims/:id/lines', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db
      .select()
      .from(insuranceClaimLines)
      .where(eq(insuranceClaimLines.claimId, c.req.param('id')))
      .orderBy(insuranceClaimLines.lineNumber)
    return c.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        clinicPrice: Number(r.clinicPrice),
        insurerPrice: Number(r.insurerPrice),
      })),
    })
  } catch (error) {
    logError(error, { context: 'Claim lines read' })
    return c.json({ error: 'Failed to load claim lines' }, 500)
  }
})

// ── PATCH /claims/:id/submit — gated on the insurer's approvals being clear ────
insuranceClaimsApp.patch('/claims/:id/submit', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [claim] = await db.select().from(insuranceClaims).where(eq(insuranceClaims.id, id)).limit(1)
  if (!claim) return c.json({ error: 'Not found' }, 404)
  if (claim.status !== 'pending') return c.json({ error: `Claim is already ${claim.status}` }, 409)

  // Gate: the company must have an effective price list with no pending rows.
  const [eff] = await db
    .select({ id: insurancePriceLists.id })
    .from(insurancePriceLists)
    .where(
      and(
        eq(insurancePriceLists.companyId, claim.companyId),
        eq(insurancePriceLists.status, 'effective')
      )
    )
    .limit(1)
  if (!eff)
    return c.json(
      {
        error: 'This insurer has no effective price list yet — upload and set one effective first',
      },
      409
    )
  const pending = await db
    .select({ id: insurancePriceListItems.id })
    .from(insurancePriceListItems)
    .where(
      and(
        eq(insurancePriceListItems.priceListId, eff.id),
        eq(insurancePriceListItems.mappingStatus, 'pending_approval')
      )
    )
    .limit(1)
  if (pending.length > 0)
    return c.json(
      { error: 'Resolve all pending service approvals for this insurer before submitting claims' },
      409
    )

  const [updated] = await db
    .update(insuranceClaims)
    .set({ status: 'submitted', submittedAt: new Date(), claimNumber: makeClaimNumber() })
    .where(eq(insuranceClaims.id, id))
    .returning()
  return c.json({ success: true, data: updated })
})

// ── PATCH /claims/:id/approve ─────────────────────────────────────────────────
insuranceClaimsApp.patch('/claims/:id/approve', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { approvedAmount?: number }
  const db = getDb(process.env.DATABASE_URL!)
  const [claim] = await db.select().from(insuranceClaims).where(eq(insuranceClaims.id, id)).limit(1)
  if (!claim) return c.json({ error: 'Not found' }, 404)
  if (claim.status !== 'submitted')
    return c.json({ error: 'Only submitted claims can be approved' }, 409)

  const [updated] = await db
    .update(insuranceClaims)
    .set({
      status: 'approved',
      approvedAmount: body.approvedAmount ?? claim.chargedAmount,
      approvedAt: new Date(),
    })
    .where(eq(insuranceClaims.id, id))
    .returning()
  return c.json({ success: true, data: updated })
})

// ── PATCH /claims/:id/deny ────────────────────────────────────────────────────
insuranceClaimsApp.patch('/claims/:id/deny', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string }
  const db = getDb(process.env.DATABASE_URL!)
  const [claim] = await db.select().from(insuranceClaims).where(eq(insuranceClaims.id, id)).limit(1)
  if (!claim) return c.json({ error: 'Not found' }, 404)
  if (claim.status !== 'submitted')
    return c.json({ error: 'Only submitted claims can be denied' }, 409)

  const [updated] = await db
    .update(insuranceClaims)
    .set({ status: 'denied', denialReason: body.reason ?? null, deniedAt: new Date() })
    .where(eq(insuranceClaims.id, id))
    .returning()
  return c.json({ success: true, data: updated })
})

// ── PATCH /claims/:id/pay ─────────────────────────────────────────────────────
insuranceClaimsApp.patch('/claims/:id/pay', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { paidAmount?: number }
  const db = getDb(process.env.DATABASE_URL!)
  const [claim] = await db.select().from(insuranceClaims).where(eq(insuranceClaims.id, id)).limit(1)
  if (!claim) return c.json({ error: 'Not found' }, 404)
  if (claim.status !== 'approved')
    return c.json({ error: 'Only approved claims can be marked paid' }, 409)

  const [updated] = await db
    .update(insuranceClaims)
    .set({
      status: 'paid',
      paidAmount: body.paidAmount ?? claim.approvedAmount ?? claim.chargedAmount,
      paidAt: new Date(),
    })
    .where(eq(insuranceClaims.id, id))
    .returning()
  return c.json({ success: true, data: updated })
})

// ── DELETE /claims/:id (pending only) ─────────────────────────────────────────
insuranceClaimsApp.delete('/claims/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.DELETE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [claim] = await db
    .select({ status: insuranceClaims.status })
    .from(insuranceClaims)
    .where(eq(insuranceClaims.id, id))
    .limit(1)
  if (!claim) return c.json({ error: 'Not found' }, 404)
  if (claim.status !== 'pending')
    return c.json({ error: 'Only pending (unsubmitted) claims can be deleted' }, 409)

  await db.delete(insuranceClaims).where(eq(insuranceClaims.id, id))
  return c.json({ success: true })
})
