import { and, asc, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { creditNoteLines, creditNotes } from '../db/schema'
import { recordDiffAudit } from '../lib/audit'
import {
  type CreditNoteReason,
  createDraftCreditNote,
  postCreditNote,
  voidCreditNote,
} from '../lib/credit-note-service'
import { errMessage } from '../lib/error-message'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const creditNotesApp = new Hono<HonoEnv>()
const MODULE = MODULES.CREDIT_NOTES

// ── L17: zod request schemas ────────────────────────────────────────────────
const moneyLike = z.union([z.string(), z.number()])

const createCreditNoteSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z.enum(['discount', 'correction', 'cancellation', 'goodwill', 'write_off']),
  amount: moneyLike.optional(),
  reasonNotes: z.string().nullish(),
  issueDate: z.string().nullish(),
  lines: z
    .array(
      z.object({
        invoiceLineId: z.string().uuid().nullish(),
        amount: moneyLike,
        revenueAccountId: z.string().uuid().nullish(),
        description: z.string().nullish(),
      })
    )
    .optional(),
})

const postCreditNoteSchema = z.object({ includeTaxReversal: z.boolean().optional() })
const createAndPostSchema = createCreditNoteSchema.extend({
  includeTaxReversal: z.boolean().optional(),
})
const voidSchema = z.object({ reason: z.string().min(1) })

// POST /api/credit-notes/create-and-post — atomic draft+post in one call.
// Prevents orphaned drafts when a two-step client call drops between requests.
// If posting fails after the draft is created, the draft is auto-voided.
creditNotesApp.post('/create-and-post', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const parsed = createAndPostSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data
  const db = getDb(process.env.DATABASE_URL!)

  let draftId: string | undefined
  try {
    const draft = await createDraftCreditNote(
      db,
      {
        invoiceId: body.invoiceId,
        reason: body.reason as CreditNoteReason,
        amount: body.amount,
        reasonNotes: body.reasonNotes ?? null,
        issueDate: body.issueDate ? new Date(body.issueDate) : undefined,
        lines: body.lines,
      },
      user.id
    )
    draftId = draft.id
    const result = await postCreditNote(db, draft.id, user.id, {
      includeTaxReversal: body.includeTaxReversal,
    })
    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: MODULE as string,
      entityId: draft.id,
      entityName: `Credit note ${result.creditNote.creditNoteNumber}`,
      before: { status: 'draft' },
      after: { status: result.creditNote.status, journalEntryId: result.journalEntry.id },
      reason: result.creditNote.reasonNotes ?? null,
    })
    return c.json({ success: true, data: result })
  } catch (err) {
    // Best-effort: void the draft so it doesn't linger in the DB.
    if (draftId) {
      try {
        await voidCreditNote(db, draftId, {
          userId: user.id,
          reason: 'auto-void: post failed',
        })
      } catch {
        // Swallow — the original error is what the caller needs.
      }
    }
    return c.json({ error: errMessage(err, 'Failed to create and post credit note') }, 400)
  }
})

// GET /api/credit-notes — list (filter by status, invoice_id, patient_id)
creditNotesApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const status = c.req.query('status')
  const invoiceId = c.req.query('invoiceId')
  const patientId = c.req.query('patientId')
  const where = []
  if (status) where.push(eq(creditNotes.status, status))
  if (invoiceId) where.push(eq(creditNotes.invoiceId, invoiceId))
  if (patientId) where.push(eq(creditNotes.patientId, patientId))

  const rows = await db.query.creditNotes.findMany({
    where: where.length > 0 ? (where.length === 1 ? where[0] : and(...where)) : undefined,
    orderBy: [desc(creditNotes.createdAt)],
  })
  return c.json({ success: true, data: rows })
})

// GET /api/credit-notes/:id
creditNotesApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const cn = await db.query.creditNotes.findFirst({
    where: eq(creditNotes.id, id),
  })
  if (!cn) return c.json({ error: 'Not found' }, 404)
  const lines = await db.query.creditNoteLines.findMany({
    where: eq(creditNoteLines.creditNoteId, id),
    orderBy: [asc(creditNoteLines.id)],
  })
  return c.json({ success: true, data: { ...cn, lines } })
})

// POST /api/credit-notes — create a draft
creditNotesApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const parsed = createCreditNoteSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const cn = await createDraftCreditNote(
      db,
      {
        invoiceId: body.invoiceId,
        reason: body.reason as CreditNoteReason,
        amount: body.amount,
        reasonNotes: body.reasonNotes ?? null,
        issueDate: body.issueDate ? new Date(body.issueDate) : undefined,
        lines: body.lines,
      },
      user.id
    )
    return c.json({ success: true, data: cn })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to draft credit note') }, 400)
  }
})

// POST /api/credit-notes/:id/post — post (writes JE, reduces invoice balance)
creditNotesApp.post('/:id/post', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  // Body is optional here; an empty/absent body is valid.
  const parsed = postCreditNoteSchema.safeParse((await c.req.json().catch(() => ({}))) ?? {})
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }

  try {
    const result = await postCreditNote(db, id, user.id, {
      includeTaxReversal: parsed.data.includeTaxReversal,
    })
    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: MODULE as string,
      entityId: id,
      entityName: `Credit note ${result.creditNote.creditNoteNumber}`,
      before: { status: 'draft' },
      after: {
        status: result.creditNote.status,
        journalEntryId: result.journalEntry.id,
      },
      reason: result.creditNote.reasonNotes ?? null,
    })
    return c.json({ success: true, data: result })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to post credit note') }, 400)
  }
})

// POST /api/credit-notes/:id/void — reverse a posted credit note
creditNotesApp.post('/:id/void', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const parsed = voidSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'reason is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const result = await voidCreditNote(db, id, { userId: user.id, reason: parsed.data.reason })
    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: MODULE as string,
      entityId: id,
      entityName: `Credit note ${result.creditNote.creditNoteNumber}`,
      before: { status: 'posted' },
      after: { status: 'void' },
      reason: parsed.data.reason,
    })
    return c.json({ success: true, data: result })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to void credit note') }, 400)
  }
})

export { creditNotesApp }
