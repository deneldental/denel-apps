/**
 * /api/journal-entries — manual journal entry endpoints.
 *
 * Phase 1 exposes:
 *   GET  /                          — list entries (paginated)
 *   GET  /:id                       — single entry with lines
 *   POST /                          — admin-only manual entry posting
 *   POST /:id/reverse               — admin-only reversal of a posted entry
 *
 * Auto-generated entries (invoice issue, payment post, etc.) reach the GL via
 * `postJournalEntry` in gl-service.ts — not via these routes.
 */

import { and, asc, desc, eq, gte, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { journalEntries, journalLines } from '../db/schema'
import { recordDiffAudit } from '../lib/audit'
import { postJournalEntry, reverseJournalEntry } from '../lib/gl-service'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser, isAdmin } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const journalEntriesApp = new Hono<HonoEnv>()

const lineSchema = z.object({
  accountId: z.string().uuid(),
  debit: z.union([z.string(), z.number()]).optional(),
  credit: z.union([z.string(), z.number()]).optional(),
  partyType: z.enum(['patient', 'supplier', 'specialist', 'insurance']).nullish(),
  partyId: z.string().uuid().nullish(),
  description: z.string().nullish(),
})

const createSchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  description: z.string().nullish(),
  lines: z.array(lineSchema).min(2),
})

// ── GET /api/journal-entries ─────────────────────────────────────────────────
journalEntriesApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.JOURNAL_ENTRIES as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const from = c.req.query('from')
  const to = c.req.query('to')
  const where =
    from && to
      ? and(gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to))
      : from
        ? gte(journalEntries.entryDate, from)
        : to
          ? lte(journalEntries.entryDate, to)
          : undefined

  const data = await db.query.journalEntries.findMany({
    where,
    orderBy: [desc(journalEntries.entryDate), desc(journalEntries.createdAt)],
    limit: 200,
  })
  return c.json({ success: true, data })
})

// ── GET /api/journal-entries/:id ─────────────────────────────────────────────
journalEntriesApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.JOURNAL_ENTRIES as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const entry = await db.query.journalEntries.findFirst({
    where: eq(journalEntries.id, id),
    with: { lines: { orderBy: [asc(journalLines.lineNumber)], with: { account: true } } },
  })
  if (!entry) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: entry })
})

// ── POST /api/journal-entries — admin manual entry ───────────────────────────
journalEntriesApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) return c.json({ error: 'Admin only' }, 403)

  const parsed = createSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400)
  const input = parsed.data

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const posted = await postJournalEntry(db, {
      entryDate: new Date(input.entryDate),
      sourceDocType: 'manual',
      sourceDocId: null,
      description: input.description ?? null,
      lines: input.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        partyType: l.partyType ?? null,
        partyId: l.partyId ?? null,
        description: l.description ?? null,
      })),
      createdBy: user.id,
    })

    await recordDiffAudit(db, {
      userId: user.id,
      action: 'create',
      module: 'journal_entries',
      entityId: posted.id,
      entityName: `Journal Entry ${posted.entryNumber}`,
      before: null,
      after: posted,
      reason: 'Manual journal entry',
    })

    return c.json({ success: true, data: posted }, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

// ── POST /api/journal-entries/:id/reverse ────────────────────────────────────
journalEntriesApp.post('/:id/reverse', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) return c.json({ error: 'Admin only' }, 403)

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string }
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const reversal = await reverseJournalEntry(db, id, {
      createdBy: user.id,
      description: body.reason ?? null,
    })

    await recordDiffAudit(db, {
      userId: user.id,
      action: 'delete',
      module: 'journal_entries',
      entityId: id,
      entityName: `Reversal ${reversal.entryNumber}`,
      before: null,
      after: reversal,
      reason: body.reason ?? null,
    })

    return c.json({ success: true, data: reversal }, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

export { journalEntriesApp }
