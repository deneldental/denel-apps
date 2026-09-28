/**
 * Petty cash (P1 + P2) — the management surface for the category-driven petty-cash
 * report tag. Directories (service providers + curated errand staff), plus the
 * transactions list and the non-blocking manager confirm/flag audit stamp.
 *
 * Petty transactions ARE just expenses whose category is flagged `isPettyCash`;
 * this router never posts to the GL — confirmation is audit metadata only.
 *
 * Mounted at /api/petty-cash (app.ts).
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import {
  expenseCategories,
  expenses,
  pettyCashReplenishments,
  pettyCashStaff,
  serviceProviders,
  staff,
  user,
} from '../db/schema'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { getPettyCashBalance } from '../lib/petty-cash-balance'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

export const pettyCashApp = new Hono<HonoEnv>()
const MODULE = MODULES.EXPENSES

// ── Service providers ──────────────────────────────────────────────────────────
pettyCashApp.get('/providers', async (c) => {
  const user2 = await getCurrentUser(c)
  if (!user2) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user2.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(serviceProviders)
    .where(eq(serviceProviders.isActive, true))
    .orderBy(serviceProviders.name)
  return c.json({ success: true, data: rows })
})

pettyCashApp.post('/providers', async (c) => {
  const user2 = await getCurrentUser(c)
  if (!user2) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user2.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; contact?: string }
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(serviceProviders)
    .values({
      name: body.name.trim(),
      contact: body.contact?.trim() || null,
      createdById: user2.id,
    })
    .returning()
  return c.json({ success: true, data: row }, 201)
})

pettyCashApp.patch('/providers/:id', async (c) => {
  const user2 = await getCurrentUser(c)
  if (!user2) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user2.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string
    contact?: string
    isActive?: boolean
  }
  const db = getDb(process.env.DATABASE_URL!)
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) set.name = body.name.trim()
  if (body.contact !== undefined) set.contact = body.contact?.trim() || null
  if (body.isActive !== undefined) set.isActive = body.isActive
  const [row] = await db
    .update(serviceProviders)
    .set(set)
    .where(eq(serviceProviders.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

pettyCashApp.delete('/providers/:id', async (c) => {
  const user2 = await getCurrentUser(c)
  if (!user2) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user2.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  // Soft delete — existing expenses keep their snapshot; directory stays clean.
  await db
    .update(serviceProviders)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(serviceProviders.id, id))
  return c.json({ success: true })
})

// ── Curated errand staff ───────────────────────────────────────────────────────
pettyCashApp.get('/staff', async (c) => {
  const user2 = await getCurrentUser(c)
  if (!user2) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user2.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select({
      id: pettyCashStaff.id,
      staffId: pettyCashStaff.staffId,
      staffCode: staff.staffId,
      fullName: staff.fullName,
      phone: staff.phone,
      position: staff.position,
    })
    .from(pettyCashStaff)
    .innerJoin(staff, eq(pettyCashStaff.staffId, staff.id))
    .orderBy(staff.fullName)
  return c.json({ success: true, data: rows })
})

// Active staff not already in the curated list (for the "add staff" picker).
pettyCashApp.get('/staff/available', async (c) => {
  const user2 = await getCurrentUser(c)
  if (!user2) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user2.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const already = await db.select({ staffId: pettyCashStaff.staffId }).from(pettyCashStaff)
  const taken = new Set(already.map((r) => r.staffId))
  const all = await db
    .select({
      id: staff.id,
      staffCode: staff.staffId,
      fullName: staff.fullName,
      position: staff.position,
    })
    .from(staff)
    .where(eq(staff.status, 'active'))
    .orderBy(staff.fullName)
  return c.json({ success: true, data: all.filter((s) => !taken.has(s.id)) })
})

pettyCashApp.post('/staff', async (c) => {
  const user2 = await getCurrentUser(c)
  if (!user2) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user2.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const body = (await c.req.json().catch(() => ({}))) as { staffId?: string }
  if (!body.staffId) return c.json({ error: 'staffId is required' }, 400)
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [row] = await db
      .insert(pettyCashStaff)
      .values({ staffId: body.staffId, addedById: user2.id })
      .onConflictDoNothing({ target: pettyCashStaff.staffId })
      .returning()
    return c.json({ success: true, data: row ?? null }, 201)
  } catch (error) {
    logError(error, { context: 'petty cash add staff' })
    return c.json({ error: 'Failed to add staff' }, 500)
  }
})

pettyCashApp.delete('/staff/:id', async (c) => {
  const user2 = await getCurrentUser(c)
  if (!user2) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user2.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  await db.delete(pettyCashStaff).where(eq(pettyCashStaff.id, id))
  return c.json({ success: true })
})

// ── Transactions (petty expenses) + confirm/flag ───────────────────────────────
pettyCashApp.get('/transactions', async (c) => {
  const user2 = await getCurrentUser(c)
  if (!user2) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user2.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { from, to, status } = c.req.query()
  const db = getDb(process.env.DATABASE_URL!)
  const submitter = alias(user, 'submitter')
  const confirmer = alias(user, 'confirmer')

  const conds = [eq(expenseCategories.isPettyCash, true)]
  if (from) conds.push(gte(expenses.date, new Date(from)))
  if (to) conds.push(lte(expenses.date, new Date(`${to}T23:59:59`)))
  if (status) conds.push(eq(expenses.confirmationStatus, status))

  const rows = await db
    .select({
      id: expenses.id,
      date: expenses.date,
      category: expenses.category,
      categoryDisplay: expenseCategories.displayName,
      pettyRefType: expenses.pettyRefType,
      amount: expenses.amount,
      paidTo: expenses.paidTo,
      pettyRefName: expenses.pettyRefName,
      pettyRefContact: expenses.pettyRefContact,
      attachmentUrl: expenses.attachmentUrl,
      paymentMethod: expenses.paymentMethod,
      description: expenses.description,
      confirmationStatus: expenses.confirmationStatus,
      confirmationNote: expenses.confirmationNote,
      confirmationProofUrl: expenses.confirmationProofUrl,
      confirmedAt: expenses.confirmedAt,
      submittedBy: submitter.name,
      confirmedBy: confirmer.name,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenses.category, expenseCategories.name))
    .leftJoin(submitter, eq(expenses.createdById, submitter.id))
    .leftJoin(confirmer, eq(expenses.confirmedById, confirmer.id))
    .where(and(...conds))
    .orderBy(desc(expenses.date))
    .limit(500)

  const totals = rows.reduce(
    (acc, r) => {
      acc.count += 1
      acc.amount += Number(r.amount) || 0
      const s = r.confirmationStatus ?? 'pending'
      acc.byStatus[s] = (acc.byStatus[s] ?? 0) + 1
      return acc
    },
    { count: 0, amount: 0, byStatus: {} as Record<string, number> }
  )

  return c.json({ success: true, data: { transactions: rows, totals } })
})

async function setConfirmation(
  c: Context<HonoEnv>,
  next: {
    status: 'confirmed' | 'flagged'
    note?: string | null
    proofUrl?: string | null
  }
) {
  const user2 = await getCurrentUser(c)
  if (!user2) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user2.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .update(expenses)
    .set({
      confirmationStatus: next.status,
      confirmationNote: next.note ?? null,
      confirmationProofUrl: next.proofUrl ?? null,
      confirmedById: user2.id,
      confirmedAt: new Date(),
    })
    .where(eq(expenses.id, id))
    .returning({ id: expenses.id })
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
}

pettyCashApp.patch('/transactions/:id/confirm', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { note?: string; proofUrl?: string }
  return setConfirmation(c, { status: 'confirmed', note: body.note, proofUrl: body.proofUrl })
})

pettyCashApp.patch('/transactions/:id/flag', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string }
  return setConfirmation(c, { status: 'flagged', note: body.reason })
})

// ── Box balance + replenishments (settings-domain-audit S5-B) ─────────────────
// `finance:petty_cash` (Settings → Finance → Petty Cash Policy) supplies the
// default float, the low-float warning and the approval limit; the balance is
// the latest replenishment minus petty disbursements since it.

pettyCashApp.get('/balance', async (c) => {
  const user2 = await getCurrentUser(c)
  if (!user2) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user2.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  try {
    const db = getDb(process.env.DATABASE_URL as string)
    return c.json({ success: true, data: await getPettyCashBalance(db) })
  } catch (error) {
    logError(error, { route: 'petty-cash.balance', userId: user2.id })
    return c.json({ error: 'Failed to compute the petty cash balance' }, 500)
  }
})

pettyCashApp.get('/replenishments', async (c) => {
  const user2 = await getCurrentUser(c)
  if (!user2) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user2.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  try {
    const db = getDb(process.env.DATABASE_URL as string)
    const recorder = alias(user, 'recorder')
    const rows = await db
      .select({
        id: pettyCashReplenishments.id,
        date: pettyCashReplenishments.date,
        amount: pettyCashReplenishments.amount,
        note: pettyCashReplenishments.note,
        recordedBy: recorder.name,
        createdAt: pettyCashReplenishments.createdAt,
      })
      .from(pettyCashReplenishments)
      .leftJoin(recorder, eq(pettyCashReplenishments.createdById, recorder.id))
      .orderBy(desc(pettyCashReplenishments.date), desc(pettyCashReplenishments.createdAt))
      .limit(50)
    return c.json({ success: true, data: rows })
  } catch (error) {
    logError(error, { route: 'petty-cash.replenishments.list', userId: user2.id })
    return c.json({ error: 'Failed to list replenishments' }, 500)
  }
})

const ReplenishmentSchema = z.object({
  /** Pesewas. */
  amount: z.number().int().positive(),
  date: z.coerce.date().optional(),
  note: z.string().trim().max(500).optional(),
})

pettyCashApp.post('/replenishments', async (c) => {
  const user2 = await getCurrentUser(c)
  if (!user2) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user2.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const parsed = ReplenishmentSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success)
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  try {
    const db = getDb(process.env.DATABASE_URL as string)
    const [row] = await db
      .insert(pettyCashReplenishments)
      .values({
        amount: parsed.data.amount,
        date: parsed.data.date ?? new Date(),
        note: parsed.data.note || null,
        createdById: user2.id,
      })
      .returning()
    return c.json({ success: true, data: row })
  } catch (error) {
    logError(error, { route: 'petty-cash.replenishments.create', userId: user2.id })
    return c.json({ error: 'Failed to record the replenishment' }, 500)
  }
})
