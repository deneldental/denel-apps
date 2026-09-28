import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import {
  accountingPeriods,
  accounts,
  expenseCategories,
  expenses,
  serviceProviders,
  staff,
} from '../db/schema'
import { createAuditLog } from '../lib/audit'
import {
  backfillCategory,
  ensureExpensePosted,
  expenseIsPosted,
  getUnpostedExpenses,
  resolveExpenseAccountId,
  reverseExpenseGL,
} from '../lib/expense-service'
import { recalculateReportTotals } from '../lib/finance-service'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { applyPettyCashReviewPolicy, PettyCashPolicyError } from '../lib/petty-cash-policy'
import { checkPermission, getCurrentUser, isAdmin } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const expensesApp = new Hono<HonoEnv>()

const MODULE = MODULES.EXPENSES

// ── Fiscal year / active months ────────────────────────────────────────
// The Create-Year dialog's {year, activeMonths[]} is NOT a new concept: a
// "fiscal year with active months" is exactly a set of `accounting_periods`
// rows, which already model one calendar month each (name "YYYY-MM",
// start/end date, status open|closed) and are what `postInOpenPeriod()` /
// `assertPeriodOpen()` enforce against. So this wires the dialog to that table
// rather than adding a parallel expense-only year table.
//
//   active month   → period created `open`   (postings allowed)
//   inactive month → period created `closed` (postings rejected)
//
// Creating the inactive months explicitly as `closed` is the point: without a
// row, `getOrCreatePeriodFor()` would auto-create an OPEN period the first time
// anything posted there, silently defeating the month selection.
//
// Existing periods are never modified — re-running for the same year is a
// no-op. Reopening or closing a period that already exists is a separate,
// audited finance operation and must not happen as a side effect of this
// dialog (it could retroactively lock or unlock already-posted entries).

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/** Resolve "January" | "january" | "1" | "01" → 1..12, or null if unrecognised. */
function resolveMonthNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 12) return raw
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase()
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s)
    return n >= 1 && n <= 12 ? n : null
  }
  const idx = MONTH_NAMES.indexOf(s)
  return idx === -1 ? null : idx + 1
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * POST /api/expenses/years — body: { year: number, activeMonths: string[] }
 * Creates the 12 accounting periods for `year`, opening the selected months
 * and closing the rest. Idempotent: months that already exist are left alone.
 *
 * Declared ahead of the `/:id` routes so it is never captured as id="years".
 *
 * Gate: `expenses:create` AND `periods:create`. This route writes
 * `accounting_periods`, the clinic-wide GL calendar that `postInOpenPeriod()` /
 * `assertPeriodOpen()` enforce against — a month created `closed` here rejects
 * postings from payments, invoices and journal entries too, not just expenses.
 * An expenses-only grant must therefore not reach it. `periods:create` is the
 * same permission `POST /api/periods` requires, and `periods` is a child of
 * `financial_records` in MODULE_HIERARCHY, so a finance/admin grant still
 * passes while an expenses-only role is refused.
 */
expensesApp.post('/years', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  if (!(await checkPermission(c, user.id, MODULES.PERIODS as string, ACTIONS.CREATE as string))) {
    return c.json(
      {
        error:
          'Creating a fiscal year opens and closes clinic-wide accounting periods. This needs the finance periods permission.',
      },
      403
    )
  }

  try {
    const body = await c.req.json()
    const year = Number(body?.year)
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      return c.json({ error: 'year must be a whole number between 2000 and 2100' }, 400)

    if (!Array.isArray(body?.activeMonths) || body.activeMonths.length === 0)
      return c.json({ error: 'activeMonths must be a non-empty array' }, 400)

    const activeSet = new Set<number>()
    for (const m of body.activeMonths) {
      const n = resolveMonthNumber(m)
      if (n === null) return c.json({ error: `Unrecognised month: ${String(m)}` }, 400)
      activeSet.add(n)
    }

    const db = getDb(process.env.DATABASE_URL!)

    const values = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1
      return {
        name: `${year}-${pad2(month)}`,
        // Last day of `month` = day 0 of the next month.
        startDate: `${year}-${pad2(month)}-01`,
        endDate: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
        status: activeSet.has(month) ? 'open' : 'closed',
      }
    })

    // Unique on (start_date, end_date) — existing periods are skipped, not
    // overwritten, so `returning()` yields exactly the newly created ones.
    const created = await db
      .insert(accountingPeriods)
      .values(values)
      .onConflictDoNothing({
        target: [accountingPeriods.startDate, accountingPeriods.endDate],
      })
      .returning({
        id: accountingPeriods.id,
        name: accountingPeriods.name,
        startDate: accountingPeriods.startDate,
        endDate: accountingPeriods.endDate,
        status: accountingPeriods.status,
      })

    const activeMonths = Array.from(activeSet)
      .sort((a, b) => a - b)
      .map((m) => `${year}-${pad2(m)}`)

    await createAuditLog(db, {
      userId: user.id,
      action: 'expense_year_create',
      module: 'expenses',
      entityName: String(year),
      changes: {
        year,
        activeMonths,
        periodsCreated: created.length,
        periodsAlreadyExisted: 12 - created.length,
      },
    })

    return c.json({
      success: true,
      data: {
        year,
        activeMonths,
        created,
        skipped: 12 - created.length,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: 'create expense year' })
    return c.json({ error: 'Failed to create expense year' }, 500)
  }
})

expensesApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const data = await db.select().from(expenses).orderBy(desc(expenses.date))
    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: 'Error fetching expenses' })
    return c.json({ error: 'Failed to fetch expenses' }, 500)
  }
})

// Phase 4: expense categories + their GL bucket mapping (admin maps each once).
expensesApp.get('/categories', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db
      .select({
        id: expenseCategories.id,
        name: expenseCategories.name,
        displayName: expenseCategories.displayName,
        accountId: expenseCategories.accountId,
        isActive: expenseCategories.isActive,
        isPettyCash: expenseCategories.isPettyCash,
        pettyRefType: expenseCategories.pettyRefType,
      })
      .from(expenseCategories)
      .orderBy(expenseCategories.name)
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: 'list expense categories' })
    return c.json({ error: 'Failed to fetch categories' }, 500)
  }
})

// Petty cash config: flag a category as petty cash + set which reference the
// expense form should require (service provider / staff / none). Admin only.
expensesApp.patch('/categories/:id/petty', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) return c.json({ error: 'Admin only' }, 403)

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as {
    isPettyCash?: boolean
    pettyRefType?: string
  }
  const refType = body.pettyRefType ?? 'none'
  if (!['none', 'service_provider', 'staff', 'specialist'].includes(refType))
    return c.json({ error: 'Invalid pettyRefType' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [cat] = await db
      .update(expenseCategories)
      .set({
        isPettyCash: body.isPettyCash ?? false,
        // A non-petty category has no reference requirement.
        pettyRefType: body.isPettyCash ? refType : 'none',
        updatedAt: new Date(),
      })
      .where(eq(expenseCategories.id, id))
      .returning()
    if (!cat) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: cat })
  } catch (error: unknown) {
    logError(error, { context: 'set expense category petty config' })
    return c.json({ error: 'Failed to update category' }, 500)
  }
})

// Map a category to its GL expense bucket, then file any backlog in that category.
expensesApp.put('/categories/:id/account', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) return c.json({ error: 'Admin only' }, 403)

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { accountId?: string | null }
  const db = getDb(process.env.DATABASE_URL!)
  try {
    // Only a real, non-control EXPENSE account is a valid bucket — anything else
    // would make every expense in this category fail to post.
    if (body.accountId) {
      const [acct] = await db
        .select({ type: accounts.type, isControl: accounts.isControl })
        .from(accounts)
        .where(eq(accounts.id, body.accountId))
        .limit(1)
      if (!acct) return c.json({ error: 'Account not found.' }, 400)
      if (acct.type !== 'expense' || acct.isControl) {
        return c.json({ error: 'Pick a non-control Expense account for this category.' }, 400)
      }
    }

    const [cat] = await db
      .update(expenseCategories)
      .set({ accountId: body.accountId ?? null, updatedAt: new Date() })
      .where(eq(expenseCategories.id, id))
      .returning()
    if (!cat) return c.json({ error: 'Not found' }, 404)
    // Sweep: stamp + file the paid backlog in this category now that it's mapped.
    let filed = 0
    if (cat.accountId) filed = await backfillCategory(db, cat.name, cat.accountId, user.id)
    // `filed` is mirrored INSIDE `data` as well: the portal's bookkeeping sheet
    // reads `res.data.filed` (the api-client returns the body verbatim, so a
    // top-level key is invisible to it) and was always reporting 0 filed.
    return c.json({ success: true, data: { ...cat, filed }, filed })
  } catch (error: unknown) {
    logError(error, { context: 'map expense category account' })
    return c.json({ error: 'Failed to map category' }, 500)
  }
})

// Phase 4: paid expenses that should be on the books but aren't yet (unmapped
// category, closed month, or an un-posted import). Surfaced so the gap is visible.
expensesApp.get('/unposted', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await getUnpostedExpenses(db)
    return c.json({ success: true, data: rows, count: rows.length })
  } catch (error: unknown) {
    logError(error, { context: 'list unposted expenses' })
    return c.json({ error: 'Failed to fetch unposted expenses' }, 500)
  }
})

// Phase 4: "file now" — post an expense from the unposted list after its category
// was mapped or its month reopened. Re-stamps the bucket if needed. Idempotent.
expensesApp.post('/:id/post', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [expense] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1)
    if (!expense) return c.json({ error: 'Not found' }, 404)

    let row = expense
    if (!row.accountId && row.category) {
      const accountId = await resolveExpenseAccountId(db, row.category)
      if (accountId) {
        const [updated] = await db
          .update(expenses)
          .set({ accountId })
          .where(eq(expenses.id, id))
          .returning()
        row = updated
      }
    }
    const result = await ensureExpensePosted(db, row, user.id)
    // Mirrored under `data` for the same reason as the category mapping above:
    // the bookkeeping sheet checks `res.data.glPosted` / `res.data.glReason`, so
    // a top-level-only payload made every file-now look like a generic failure
    // even when the entry posted. Top-level keys kept for existing callers.
    return c.json({
      success: result.posted,
      glPosted: result.posted,
      glReason: result.reason,
      data: { id, glPosted: result.posted, glReason: result.reason, entryId: result.entryId },
    })
  } catch (error: unknown) {
    logError(error, { context: 'file-now expense' })
    return c.json({ error: 'Failed to file expense' }, 500)
  }
})

expensesApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    const [data] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1)
    if (!data) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: 'Error fetching expense by id' })
    return c.json({ error: 'Failed' }, 500)
  }
})

// Petty cash: resolve + snapshot the recipient reference and set the review
// status, all server-side. Mutates `data` in place before the insert.
// biome-ignore lint/suspicious/noExplicitAny: expense insert payload is a loose object
async function applyPettyCashFields(db: ReturnType<typeof getDb>, data: any) {
  const [cat] = data.category
    ? await db
        .select({
          isPettyCash: expenseCategories.isPettyCash,
          pettyRefType: expenseCategories.pettyRefType,
        })
        .from(expenseCategories)
        .where(eq(expenseCategories.name, data.category))
        .limit(1)
    : []

  if (!cat?.isPettyCash) {
    // Non-petty category — never carries a petty reference or review status.
    data.pettyRefType = null
    data.pettyRefId = null
    data.pettyRefName = null
    data.pettyRefContact = null
    data.confirmationStatus = null
    return
  }

  data.confirmationStatus = 'pending'
  data.pettyRefType = cat.pettyRefType
  if (cat.pettyRefType === 'service_provider' && data.pettyRefId) {
    const [p] = await db
      .select({ name: serviceProviders.name, contact: serviceProviders.contact })
      .from(serviceProviders)
      .where(eq(serviceProviders.id, data.pettyRefId))
      .limit(1)
    data.pettyRefName = p?.name ?? data.paidTo ?? null
    data.pettyRefContact = p?.contact ?? null
  } else if (cat.pettyRefType === 'staff' && data.pettyRefId) {
    const [s] = await db
      .select({ fullName: staff.fullName, phone: staff.phone })
      .from(staff)
      .where(eq(staff.id, data.pettyRefId))
      .limit(1)
    data.pettyRefName = s?.fullName ?? data.paidTo ?? null
    data.pettyRefContact = s?.phone ?? null
  } else if (cat.pettyRefType === 'specialist' && data.pettyRefId) {
    const { specialists } = await import('../db/schema')
    const [sp] = await db
      .select({ name: specialists.name, contactPhone: specialists.contactPhone })
      .from(specialists)
      .where(eq(specialists.id, data.pettyRefId))
      .limit(1)
    data.pettyRefName = sp?.name ?? data.paidTo ?? null
    data.pettyRefContact = sp?.contactPhone ?? null
  } else {
    // pettyRefType 'none' (or missing id) — keep the free-text payee as the name.
    data.pettyRefId = null
    data.pettyRefName = data.paidTo ?? null
    data.pettyRefContact = null
  }
}

expensesApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const data = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    if (data.amount != null && Number(data.amount) < 0) {
      return c.json({ error: 'Amount cannot be negative.' }, 400)
    }
    // `expenses.amount` is integer CENTS (migration 0209) and the portal posts
    // `Math.round(cedis * 100)`. A fractional amount reached Postgres as-is and
    // came back as an opaque 500; say what is wrong instead.
    if (data.amount != null && !Number.isInteger(Number(data.amount))) {
      return c.json({ error: 'Amount must be a whole number of pesewas (cents).' }, 400)
    }
    // Never let a NULL status slip past the 'paid' default (it would hide the
    // expense from both posting and the unposted list).
    if (data.status == null) data.status = 'paid'

    // Ensure date is a Date object for Drizzle. The POST body is still read raw,
    // so unlike the PATCH it has had no z.coerce.date() applied.
    if (data.date && typeof data.date === 'string') {
      data.date = new Date(data.date)
    }

    // Stamp the GL bucket for this category (stable id). Always derived server-side;
    // a client-supplied accountId is ignored so the stamp can't be forged.
    data.accountId = data.category ? await resolveExpenseAccountId(db, data.category) : null

    // Petty cash: if the category is flagged petty, snapshot the recipient
    // (staff/provider) server-side and drop the expense into the review queue.
    // Non-petty categories have their petty fields cleared.
    await applyPettyCashFields(db, data)
    // Settings → Finance → Petty Cash Policy (settings-domain-audit S5-B): at or
    // below the approval limit the review is confirmed on the spot; a staff
    // member at the IOU cap is refused before anything is written.
    try {
      await applyPettyCashReviewPolicy(db, data, user.id)
    } catch (policyError) {
      if (policyError instanceof PettyCashPolicyError)
        return c.json({ error: policyError.message, code: 'PETTY_CASH_IOU_CAP' }, 409)
      throw policyError
    }

    const [newItem] = await db.insert(expenses).values(data).returning()

    // Phase 4: ensure the expense is on the books. A genuine GL bug is logged but
    // never blocks recording the expense; an unmapped category / closed period come
    // back as a reason so the client can tell the user it's "not yet on the books".
    let gl: { posted: boolean; reason?: string } = { posted: false }
    try {
      gl = await ensureExpensePosted(db, newItem, user.id)
    } catch (glError) {
      // A genuine GL bug (not a closed period / unmapped) — distinguish it from the
      // expected reasons so it isn't mistaken for "not mapped yet".
      logError(glError, { context: 'expense GL posting (non-fatal)' })
      gl = { posted: false, reason: 'error' }
    }

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'expenses',
      entityId: newItem.id,
      entityName: `${newItem.category} - ${(newItem.amount / 100).toFixed(2)} GHS`,
      // Flag whether it reached the books (and why not) so the gap is in the audit
      // trail, not only on a screen nobody opened.
      changes: { ...data, glPosted: gl.posted, glReason: gl.reason ?? null },
    })

    return c.json({ success: true, data: newItem, glPosted: gl.posted, glReason: gl.reason })
  } catch (error: unknown) {
    logError(error, { context: 'Error creating expense' })
    return c.json({ error: 'Failed to create expense' }, 500)
  }
})

/**
 * Fields a caller may edit on an existing expense.
 *
 * Deliberately excluded (system-owned, not caller-owned):
 *   `dailyReportId`  — the M5.6 edit-lock is keyed on it; a client that could
 *                      set it could move an expense between reports and corrupt
 *                      both reports' totals
 *   `accountId`      — server-derived from the category (re-stamped below)
 *   `petty*`, `confirmation*`, `confirmedById/At` — stamped at create, and owned
 *                      by the dedicated routes in petty-cash.ts
 *   `deferred*`, `linkedEntity*`, `createdById`, `createdAt`, `id`
 *
 * zod strips unknown keys, so only these reach `.set()`. Before this the raw
 * request body did, making every column above client-writable.
 */
const updateExpenseSchema = z
  .object({
    category: z.string().trim().min(1).optional(),
    // Integer CENTS — see the POST handler's guard.
    amount: z.number().int().finite().optional(),
    date: z.coerce.date().optional(),
    description: z.string().nullish(),
    paidTo: z.string().nullish(),
    paymentMethod: z.string().nullish(),
    attachmentUrl: z.string().nullish(),
    status: z.string().trim().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Supply at least one updatable field',
  })

expensesApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const parsed = updateExpenseSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  }
  const data: z.infer<typeof updateExpenseSchema> & { accountId?: string | null } = {
    ...parsed.data,
  }

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)

    // M5.6 — expense lock: if the expense is attached to a daily report, only admins
    // can edit. Receptionists get 403; we audit-log the denied attempt.
    const [existing] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1)
    if (!existing) return c.json({ error: 'Expense not found' }, 404)

    const admin = await isAdmin(c, user.id)
    if (existing.dailyReportId && !admin) {
      c.set('skipAudit', true)
      await createAuditLog(db, {
        userId: user.id,
        action: 'update',
        module: 'expenses',
        entityId: id,
        entityName: `${existing.category} - ${(existing.amount / 100).toFixed(2)} GHS`,
        changes: { attempted: true, denied: 'locked' },
      })
      return c.json({ error: 'Expense is locked — attached to a submitted daily report' }, 403)
    }

    // Phase 4: a posted expense's money fields are immutable (standard accounting).
    // Non-money edits (description, attachment, paidTo) stay allowed.
    const financialChanged =
      ('amount' in data && Number(data.amount) !== Number(existing.amount)) ||
      ('category' in data && data.category !== existing.category) ||
      ('paymentMethod' in data && data.paymentMethod !== existing.paymentMethod) ||
      ('status' in data && data.status !== existing.status) ||
      // `data.date` is already a Date (z.coerce.date()); an unparseable value
      // never reaches here — it is rejected as a 400 at the schema boundary.
      (data.date != null &&
        (existing.date == null || data.date.getTime() !== new Date(existing.date).getTime()))
    if (financialChanged && (await expenseIsPosted(db, id))) {
      return c.json(
        {
          error:
            'This expense is already in the accounts. Delete and re-add it to change the amount, category, payment method, or date.',
        },
        409
      )
    }

    if (data.amount != null && Number(data.amount) < 0) {
      return c.json({ error: 'Amount cannot be negative.' }, 400)
    }

    // The stamped GL bucket is server-derived only — never trust a client accountId
    // (it must not be able to re-point a posted expense's debit account).
    data.accountId = undefined
    // Category changed on an un-posted expense -> re-stamp it so it files under the
    // right account. (A posted expense's money fields were blocked above.)
    if (data.category && data.category !== existing.category) {
      data.accountId = await resolveExpenseAccountId(db, data.category)
    }

    const [updated] = await db.update(expenses).set(data).where(eq(expenses.id, id)).returning()

    if (!updated) return c.json({ error: 'Expense not found' }, 404)

    // Phase 4: an edit may have made an un-posted expense postable (category now
    // mapped, status -> paid, amount > 0). Ensure it's on the books. Best-effort;
    // a money-edit on an ALREADY-posted expense was blocked above.
    try {
      await ensureExpensePosted(db, updated, user.id)
    } catch (glError) {
      logError(glError, { context: 'expense GL repost (non-fatal)' })
    }

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'expenses',
      entityId: id,
      entityName: `${updated.category} - ${(updated.amount / 100).toFixed(2)} GHS`,
      changes: data,
    })

    // M5.6 — admin cascade: if this expense is attached to a daily report, recompute
    // the report's totals so downstream aggregates stay consistent with the edit.
    if (updated.dailyReportId) {
      await recalculateReportTotals(db, updated.dailyReportId)
      await createAuditLog(db, {
        userId: user.id,
        action: 'update',
        module: 'reports',
        entityId: updated.dailyReportId,
        entityName: `daily_report:${updated.dailyReportId}`,
        changes: {
          cascadeFrom: 'expense',
          expenseId: id,
          reason: 'admin edited locked expense; totals recomputed',
        },
      })
    }

    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

expensesApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)

    const [expense] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1)
    if (!expense) return c.json({ error: 'Not found' }, 404)

    // M5.6 parity with edit: a report-attached expense is admin-only.
    const admin = await isAdmin(c, user.id)
    if (expense.dailyReportId && !admin) {
      c.set('skipAudit', true)
      await createAuditLog(db, {
        userId: user.id,
        action: 'delete',
        module: 'expenses',
        entityId: id,
        entityName: `${expense.category} - ${expense.amount} GHS`,
        changes: { attempted: true, denied: 'locked' },
      })
      return c.json({ error: 'Expense is locked — attached to a submitted daily report' }, 403)
    }

    // Phase 4: if the expense is on the books, reverse it (in its ORIGINAL month)
    // BEFORE deleting so no ghost entry is left. Reverse-then-delete is self-healing:
    // if a retry finds it already reversed, the books are already netted and we just
    // remove the row. A closed original month blocks the delete.
    if (await expenseIsPosted(db, id)) {
      try {
        await reverseExpenseGL(db, id, user.id)
      } catch (glError) {
        const msg = String((glError as Error)?.message ?? glError).toLowerCase()
        if (msg.includes('already reversed') || msg.includes('reversal already')) {
          // GL already netted by a prior attempt — fall through and remove the row.
        } else if (msg.includes('period') || msg.includes('closed')) {
          logError(glError, { context: 'expense delete blocked (closed month)' })
          return c.json(
            {
              error:
                'This expense is in a closed accounting month. Reopen the month or record a correction instead of deleting it.',
            },
            409
          )
        } else {
          logError(glError, { context: 'expense delete GL error' })
          return c.json({ error: 'Failed to delete expense.' }, 500)
        }
      }
    }

    await db.delete(expenses).where(eq(expenses.id, id))

    // Keep the daily report's cached total in sync (parity with edit).
    if (expense.dailyReportId) {
      await recalculateReportTotals(db, expense.dailyReportId)
    }

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: 'expenses',
      entityId: id,
      entityName: `${expense.category} - ${expense.amount} GHS`,
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

export { expensesApp }
