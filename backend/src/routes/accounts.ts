/**
 * /api/accounts — Chart of Accounts CRUD.
 *
 * Reads are gated by `accounts:read`. Mutations require `accounts:create/update/delete`
 * and (per Phase 1 policy) admin role for the irreversible operations.
 *
 * Exception: the LIST endpoint also accepts `payments:read`. Invoice line entry
 * needs the revenue-account picker, and billing roles (reception) hold payments
 * without accounts — without this they can read an invoice but never add a line
 * to it. Mirrors the same fallback on GET /api/specialists/directory.
 */

import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { accounts } from '../db/schema'
import { recordDiffAudit } from '../lib/audit'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const accountsApp = new Hono<HonoEnv>()

const accountTypeSchema = z.enum(['asset', 'liability', 'equity', 'revenue', 'expense'])
const normalBalanceSchema = z.enum(['debit', 'credit'])
const partyTypeSchema = z.enum(['patient', 'supplier', 'specialist', 'insurance'])

const createSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  type: accountTypeSchema,
  subtype: z.string().max(50).nullish(),
  parentId: z.string().uuid().nullish(),
  isControl: z.boolean().default(false),
  controlPartyType: partyTypeSchema.nullish(),
  normalBalance: normalBalanceSchema,
  description: z.string().nullish(),
})

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
})

// ── GET /api/accounts ────────────────────────────────────────────────────────
accountsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const canRead =
    (await checkPermission(c, user.id, MODULES.ACCOUNTS as string, ACTIONS.READ as string)) ||
    (await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.READ as string))
  if (!canRead) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const type = c.req.query('type')
  const data = await db.query.accounts.findMany({
    where: type ? eq(accounts.type, type) : undefined,
    orderBy: [asc(accounts.code)],
  })
  return c.json({ success: true, data })
})

// ── GET /api/accounts/:id ────────────────────────────────────────────────────
accountsApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.ACCOUNTS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const data = await db.query.accounts.findFirst({ where: eq(accounts.id, c.req.param('id')) })
  if (!data) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data })
})

// ── POST /api/accounts ───────────────────────────────────────────────────────
accountsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.ACCOUNTS as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const parsed = createSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400)
  const input = parsed.data

  if (input.isControl && !input.controlPartyType) {
    return c.json({ error: 'control accounts require controlPartyType' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const [created] = await db.insert(accounts).values(input).returning()

  await recordDiffAudit(db, {
    userId: user.id,
    action: 'create',
    module: 'accounts',
    entityId: created.id,
    entityName: `Account ${created.code} ${created.name}`,
    before: null,
    after: created,
    reason: null,
  })

  return c.json({ success: true, data: created }, 201)
})

// ── PATCH /api/accounts/:id ──────────────────────────────────────────────────
accountsApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.ACCOUNTS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const parsed = updateSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const before = await db.query.accounts.findFirst({ where: eq(accounts.id, id) })
  if (!before) return c.json({ error: 'Not found' }, 404)

  const [updated] = await db
    .update(accounts)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(accounts.id, id))
    .returning()

  await recordDiffAudit(db, {
    userId: user.id,
    action: 'update',
    module: 'accounts',
    entityId: id,
    entityName: `Account ${updated.code} ${updated.name}`,
    before,
    after: updated,
    reason: null,
  })

  return c.json({ success: true, data: updated })
})

export { accountsApp }
