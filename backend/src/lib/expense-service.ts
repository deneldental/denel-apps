/**
 * expense-service.ts — admin-v1 Phase 4 (Option A: the books are the single truth).
 *
 * A PAID expense carries the GL expense account it belongs to (`expense.accountId`,
 * stamped at record time). Posting is DR that account / CR the cash/MoMo/bank/card
 * channel. Idempotent on ('expense', id).
 *
 *  - `resolveExpenseAccountId` maps a category name -> its GL account (case-insensitive).
 *  - `ensureExpensePosted` is the ONE routine every create/update path calls. It posts
 *    if postable, else returns a REASON (never silently swallows). Idempotent.
 *  - Posting resolves the debit account from the STAMPED id, so a later category
 *    rename/re-map never corrupts an already-posted entry.
 *  - `reverseExpenseGL` reverses in the ORIGINAL period (per-month totals stay right);
 *    throws if that period is closed so delete can be blocked.
 *  - `backfillCategory` / `postUnpostedInRange` are the sweeps that file the backlog
 *    when a category is mapped or a month is reopened.
 */

import { Money } from '@denel/utils'
import { and, desc, eq, gt, isNotNull, isNull, notInArray, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { expenseCategories, expenses, journalEntries } from '../db/schema'
import { type PaymentMethod, resolveChannelAccountId } from './channel-accounts'
import { postJournalEntry, reverseJournalEntry } from './gl-service'

type ExpenseRow = typeof expenses.$inferSelect

export type EnsureReason = 'not_paid' | 'zero_amount' | 'unmapped_category' | 'closed_period'
export interface EnsureResult {
  posted: boolean
  entryId?: string
  reason?: EnsureReason
}

const KNOWN_METHODS: PaymentMethod[] = [
  'cash',
  'card',
  'momo',
  'bank_transfer',
  'transfer',
  'cheque',
]
/** Map free-text payment method to a real channel (card/cheque/bank no longer collapse to cash). */
function normalizeMethod(m: string | null): PaymentMethod {
  const s = (m ?? '').toLowerCase().trim().replace(/\s+/g, '_')
  if ((KNOWN_METHODS as string[]).includes(s)) return s as PaymentMethod
  if (s.includes('momo') || s.includes('mobile') || s.includes('mtn')) return 'momo'
  if (s.includes('card')) return 'card'
  if (s.includes('cheque') || s.includes('check')) return 'cheque'
  if (s.includes('bank') || s.includes('transfer')) return 'bank_transfer'
  return 'cash'
}

/** The GL expense account for a category name (case-insensitive), or null if unmapped. */
export async function resolveExpenseAccountId(
  db: DB,
  categoryName: string | null
): Promise<string | null> {
  if (!categoryName) return null
  const [cat] = await db
    .select({ accountId: expenseCategories.accountId })
    .from(expenseCategories)
    .where(sql`lower(trim(${expenseCategories.name})) = lower(trim(${categoryName}))`)
    .limit(1)
  return cat?.accountId ?? null
}

/** The live (non-reversed) GL entry for an expense, or null if it never posted. */
async function findExpenseEntry(
  db: DB,
  expenseId: string
): Promise<{ id: string; entryDate: string } | null> {
  const [row] = await db
    .select({ id: journalEntries.id, entryDate: journalEntries.entryDate })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.sourceDocType, 'expense'),
        eq(journalEntries.sourceDocId, expenseId),
        eq(journalEntries.isReversal, false)
      )
    )
    .limit(1)
  return row ?? null
}

/** True if this expense has a live GL entry (so its money fields are locked). */
export async function expenseIsPosted(db: DB, expenseId: string): Promise<boolean> {
  return (await findExpenseEntry(db, expenseId)) !== null
}

/**
 * Idempotently ensure a PAID expense is on the books, using its STAMPED accountId.
 * Returns whether it's posted and, if not, why — so callers surface it instead of
 * losing it. Throws only on a genuine GL bug (missing channel / unbalanced).
 */
export async function ensureExpensePosted(
  db: DB,
  expense: ExpenseRow,
  createdBy: string
): Promise<EnsureResult> {
  if (expense.status !== 'paid') return { posted: false, reason: 'not_paid' }
  if (!expense.amount || expense.amount <= 0) return { posted: false, reason: 'zero_amount' }

  const existing = await findExpenseEntry(db, expense.id)
  if (existing) return { posted: true, entryId: existing.id }

  // Use the stamped account; if a path inserted without one, resolve from the
  // category and stamp it back so reports + future posts use the stable id.
  let accountId = expense.accountId
  if (!accountId) {
    accountId = await resolveExpenseAccountId(db, expense.category)
    if (!accountId) return { posted: false, reason: 'unmapped_category' }
    await db.update(expenses).set({ accountId }).where(eq(expenses.id, expense.id))
  }

  const channelId = await resolveChannelAccountId(db, normalizeMethod(expense.paymentMethod))
  const amount = Money.from(expense.amount)
  try {
    const entry = await postJournalEntry(db, {
      entryDate: expense.date ?? new Date(),
      sourceDocType: 'expense',
      sourceDocId: expense.id,
      description: `Expense: ${expense.category}${expense.paidTo ? ` — ${expense.paidTo}` : ''}`,
      createdBy,
      lines: [
        {
          accountId,
          debit: amount,
          description: expense.description ?? expense.category,
        },
        {
          accountId: channelId,
          credit: amount,
          description: `Paid via ${expense.paymentMethod ?? 'cash'}`,
        },
      ],
    })
    return { posted: true, entryId: entry.id }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).toLowerCase()
    if (msg.includes('period') || msg.includes('closed')) {
      return { posted: false, reason: 'closed_period' }
    }
    throw e // genuine GL bug — must surface, not hide
  }
}

/**
 * Reverse an expense's GL entry IN ITS ORIGINAL PERIOD. Throws if that period is
 * closed (callers must treat as "can't delete — reopen or correct"). No-op if it
 * never posted. The catch-all in callers must distinguish "already reversed".
 */
export async function reverseExpenseGL(
  db: DB,
  expenseId: string,
  createdBy: string
): Promise<void> {
  const entry = await findExpenseEntry(db, expenseId)
  if (!entry) return
  await reverseJournalEntry(db, entry.id, {
    createdBy,
    reversalDate: new Date(entry.entryDate),
  })
}

/**
 * Paid expenses that should be on the books but aren't yet (unmapped category,
 * closed month, or a path that didn't post). Surfaced so the gap is never silent.
 */
export async function getUnpostedExpenses(db: DB, limit = 1000) {
  const postedExpenseIds = db
    .select({ id: journalEntries.sourceDocId })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.sourceDocType, 'expense'),
        eq(journalEntries.isReversal, false),
        // Guard NOT IN against a stray NULL (which would drop every row).
        isNotNull(journalEntries.sourceDocId)
      )
    )

  return db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.status, 'paid'),
        gt(expenses.amount, 0),
        notInArray(expenses.id, postedExpenseIds)
      )
    )
    .orderBy(desc(expenses.date))
    .limit(limit)
}

/**
 * Sweep: when a category is mapped to `accountId`, stamp it onto every paid,
 * not-yet-stamped expense in that category and file them. Returns the count filed.
 */
export async function backfillCategory(
  db: DB,
  categoryName: string,
  accountId: string,
  createdBy: string
): Promise<number> {
  const rows = await db
    .select()
    .from(expenses)
    .where(
      and(
        sql`lower(trim(${expenses.category})) = lower(trim(${categoryName}))`,
        isNull(expenses.accountId),
        eq(expenses.status, 'paid')
      )
    )
  let filed = 0
  for (const row of rows) {
    await db.update(expenses).set({ accountId }).where(eq(expenses.id, row.id))
    try {
      const r = await ensureExpensePosted(db, { ...row, accountId }, createdBy)
      if (r.posted) filed++
    } catch {
      // genuine GL error on one row must not abort the whole sweep
    }
  }
  return filed
}

/**
 * Sweep: after a month is reopened, file any stamped-but-unposted paid expenses
 * dated in that window. Returns the count filed.
 */
export async function postUnpostedInRange(
  db: DB,
  start: Date,
  end: Date,
  createdBy: string
): Promise<number> {
  const rows = await getUnpostedExpenses(db, 5000)
  let filed = 0
  for (const row of rows) {
    if (!row.accountId || !row.date) continue
    const d = new Date(row.date)
    if (d < start || d > end) continue
    try {
      const r = await ensureExpensePosted(db, row, createdBy)
      if (r.posted) filed++
    } catch {
      // skip a row that genuinely errors; it stays on the unposted list
    }
  }
  return filed
}
