/**
 * gl-service.ts
 *
 * The single entry point for writing journal entries to the General Ledger.
 *
 * Every financial document service in the system (invoices, payments, bills,
 * credit notes, payouts, etc.) calls `postJournalEntry` to record its GL
 * impact. The service validates the entry, allocates an entry number,
 * inserts the header + lines, and returns the persisted entry.
 *
 * Guarantees:
 *  - Every entry is balanced: SUM(debit) = SUM(credit).
 *  - Every line has either debit > 0 or credit > 0 (never both, never zero).
 *  - Every line touching a control account carries a `partyType` + `partyId`.
 *  - The entry's date falls in an open period.
 *  - Idempotent on (sourceDocType, sourceDocId): re-posting returns the
 *    existing entry instead of creating a duplicate.
 */

import { Money, type MoneyLike } from '@denel/utils'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { DB } from '../db'
import { accounts, journalEntries, journalLines } from '../db/schema'
import { assertPeriodOpen } from './period-service'
import { nextNumber } from './sequence-service'

export type JournalLineInput = {
  accountId: string
  debit?: MoneyLike
  credit?: MoneyLike
  partyType?: 'patient' | 'supplier' | 'specialist' | 'insurance' | null
  partyId?: string | null
  description?: string | null
}

export type PostEntryInput = {
  entryDate: Date
  sourceDocType:
    | 'invoice'
    | 'payment'
    | 'credit_note'
    | 'refund'
    | 'bill'
    | 'specialist_payout'
    | 'write_off'
    | 'manual'
    | 'reversal'
    | 'depreciation'
    | 'period_close'
    | 'retail_sale' // admin-v1 §12.2 — store sale revenue + COGS
    | 'payroll' // admin-v1 §14.1 — payroll run (publish: accrue salaries + statutory payables)
    | 'payroll_disbursement' // HR-H9 — net pay disbursed (DR Net Salaries Payable / CR Bank)
    | 'expense' // admin-v1 §F-expenses — one-off paid expense
    | 'insurance_claim' // admin-v1 §7.x — insurer billed (AR-Insurance)
    | 'insurance_payment' // admin-v1 §7.x — insurer payment received
    | 'insurance_shortfall' // admin-v1 §7.x — insurer under-paid; write off to bad debt
    | 'remittance' // admin-v1 §14.2 — statutory payable remitted to government
    | 'inventory_receipt' // admin-v1 §11.2 — costed goods-received receipt
    | 'wht_certificate' // admin-v1 §4.4 — WHT cert issued (DR WHT Expense / CR WHT Payable)
    | 'cit_installment' // admin-v1 §4.4 — CIT installment paid (DR CIT Expense / CR Bank)
    | 'asset_disposal' // admin-v1 §4.6 — fixed asset disposed (clear asset + accum dep; gain/loss)
  sourceDocId?: string | null
  description?: string | null
  lines: JournalLineInput[]
  createdBy: string
  isReversal?: boolean
  reversesEntryId?: string | null
}

export type PostedEntry = typeof journalEntries.$inferSelect & {
  lines: (typeof journalLines.$inferSelect)[]
}

/**
 * Post a journal entry. Wraps everything in a transaction so partial writes
 * are impossible.
 */
export async function postJournalEntry(db: DB, input: PostEntryInput): Promise<PostedEntry> {
  validateLines(input.lines)

  return db.transaction(async (tx) => {
    // Idempotency: if a non-null source_doc_id already has an entry, return it.
    if (input.sourceDocId) {
      const existing = await tx.query.journalEntries.findFirst({
        where: and(
          eq(journalEntries.sourceDocType, input.sourceDocType),
          eq(journalEntries.sourceDocId, input.sourceDocId)
        ),
      })
      if (existing) {
        const lines = await tx.query.journalLines.findMany({
          where: eq(journalLines.entryId, existing.id),
          orderBy: [asc(journalLines.lineNumber)],
        })
        return { ...existing, lines }
      }
    }

    // Ensure every control-account line has a party reference.
    await validateControlPartyRefs(tx, input.lines)

    const period = await assertPeriodOpen(tx, input.entryDate)
    const entryNumber = await nextNumber(tx, 'journal_entry', input.entryDate)

    const [entry] = await tx
      .insert(journalEntries)
      .values({
        entryNumber,
        entryDate: toIsoDate(input.entryDate),
        periodId: period.id,
        description: input.description ?? null,
        sourceDocType: input.sourceDocType,
        sourceDocId: input.sourceDocId ?? null,
        isReversal: input.isReversal ?? false,
        reversesEntryId: input.reversesEntryId ?? null,
        createdBy: input.createdBy,
      })
      .returning()

    const lineRows = input.lines.map((line, idx) => {
      const debit = Money.from(line.debit ?? 0)
      const credit = Money.from(line.credit ?? 0)
      return {
        entryId: entry.id,
        lineNumber: idx + 1,
        accountId: line.accountId,
        debit: debit.toDbValue(),
        credit: credit.toDbValue(),
        partyType: line.partyType ?? null,
        partyId: line.partyId ?? null,
        description: line.description ?? null,
      }
    })

    const lines = await tx.insert(journalLines).values(lineRows).returning()
    return { ...entry, lines }
  })
}

/**
 * Load a posted journal entry (header + ordered lines) by id, or `null` if it
 * doesn't exist. The finance services use this for their idempotency replay:
 * when a document already carries a `journal_entry_id`, re-posting returns the
 * existing entry instead of duplicating it (L13 — this was copy-pasted into
 * `postPayment`, `issueInvoice`, `postBill`, `postPayout`, `postCreditNote`).
 */
export async function loadPostedEntry(db: DB, journalEntryId: string): Promise<PostedEntry | null> {
  const entry = await db.query.journalEntries.findFirst({
    where: eq(journalEntries.id, journalEntryId),
  })
  if (!entry) return null
  const lines = await db.query.journalLines.findMany({
    where: eq(journalLines.entryId, entry.id),
    orderBy: [asc(journalLines.lineNumber)],
  })
  return { ...entry, lines }
}

/**
 * Build a balanced reversal of a posted entry. The new entry mirrors the
 * original lines with debits and credits swapped, ties back via
 * `reversesEntryId`, and is dated `reversalDate` (defaulting to today).
 */
export async function reverseJournalEntry(
  db: DB,
  originalEntryId: string,
  opts: { createdBy: string; reversalDate?: Date; description?: string | null }
): Promise<PostedEntry> {
  const original = await db.query.journalEntries.findFirst({
    where: eq(journalEntries.id, originalEntryId),
    with: { lines: { orderBy: [asc(journalLines.lineNumber)] } },
  })
  if (!original) throw new Error(`journal entry ${originalEntryId} not found`)
  if (original.isReversal) {
    throw new Error(
      `entry ${original.entryNumber} is itself a reversal — cannot reverse a reversal`
    )
  }
  // H11: refuse to reverse an entry that already has a reversal. A second
  // reversal would post the mirror lines again, double-crediting/-debiting
  // every account on the original entry and silently drifting the GL.
  // (Document-driven callers — voidInvoice, reversePayment, voidBill — also
  // lock their source row first, so this guard is the backstop for the raw
  // POST /api/journal-entries/:id/reverse path and any concurrent retry.)
  const existingReversal = await db.query.journalEntries.findFirst({
    where: eq(journalEntries.reversesEntryId, originalEntryId),
  })
  if (existingReversal) {
    throw new Error(
      `entry ${original.entryNumber} is already reversed by ${existingReversal.entryNumber}`
    )
  }

  const reversalLines: JournalLineInput[] = original.lines.map((line) => ({
    accountId: line.accountId,
    debit: line.credit, // swap
    credit: line.debit,
    partyType: line.partyType as JournalLineInput['partyType'],
    partyId: line.partyId,
    description: line.description,
  }))

  return postJournalEntry(db, {
    entryDate: opts.reversalDate ?? new Date(),
    sourceDocType: 'reversal',
    sourceDocId: null,
    description: opts.description ?? `Reversal of ${original.entryNumber}`,
    lines: reversalLines,
    createdBy: opts.createdBy,
    isReversal: true,
    reversesEntryId: original.id,
  })
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function validateLines(lines: JournalLineInput[]): void {
  if (lines.length < 2) {
    throw new Error('journal entry must have at least two lines')
  }

  let totalDebit = Money.zero()
  let totalCredit = Money.zero()

  for (const [idx, line] of lines.entries()) {
    const debit = Money.from(line.debit ?? 0)
    const credit = Money.from(line.credit ?? 0)

    if (debit.isNegative() || credit.isNegative()) {
      throw new Error(`line ${idx + 1}: debit and credit must be non-negative`)
    }
    const hasDebit = debit.isPositive()
    const hasCredit = credit.isPositive()
    if (hasDebit === hasCredit) {
      throw new Error(
        `line ${idx + 1}: exactly one of debit or credit must be positive (got debit=${debit.toString()}, credit=${credit.toString()})`
      )
    }

    totalDebit = totalDebit.add(debit)
    totalCredit = totalCredit.add(credit)
  }

  if (!totalDebit.eq(totalCredit)) {
    throw new Error(
      `journal entry is unbalanced: debit total ${totalDebit.toString()} != credit total ${totalCredit.toString()}`
    )
  }
}

async function validateControlPartyRefs(db: DB, lines: JournalLineInput[]): Promise<void> {
  const accountIds = Array.from(new Set(lines.map((l) => l.accountId)))
  if (accountIds.length === 0) return

  const accountRows = await db
    .select({
      id: accounts.id,
      code: accounts.code,
      isControl: accounts.isControl,
      controlPartyType: accounts.controlPartyType,
    })
    .from(accounts)
    .where(inArray(accounts.id, accountIds))

  const byId = new Map(accountRows.map((a) => [a.id, a]))

  for (const [idx, line] of lines.entries()) {
    const account = byId.get(line.accountId)
    if (!account) {
      throw new Error(`line ${idx + 1}: account ${line.accountId} not found`)
    }
    if (account.isControl) {
      if (!line.partyType || !line.partyId) {
        throw new Error(
          `line ${idx + 1}: control account ${account.code} requires partyType and partyId`
        )
      }
      if (account.controlPartyType && account.controlPartyType !== line.partyType) {
        throw new Error(
          `line ${idx + 1}: account ${account.code} expects party_type=${account.controlPartyType}, got ${line.partyType}`
        )
      }
    }
  }
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Out-param a caller can pass to learn whether the entry was re-dated (HR-H2).
 * When `preferredDate`'s period is closed, the entry falls back to the current
 * open period — a prior-period adjustment. Callers that care (e.g. payroll) pass
 * this object to surface the move; callers that don't are unaffected.
 */
export interface PostInOpenPeriodDetail {
  redated: boolean
  postedDate: Date | null
}

/**
 * Post into `preferredDate`'s period; if that month is closed/unprovisioned, fall
 * back to the current open period (a standard prior-period adjustment) so the entry
 * is NEVER silently dropped. Returns 'posted' or 'closed' (only if today's period is
 * also somehow closed). Idempotent via the underlying postJournalEntry.
 *
 * HR-H2: pass `detail` to learn whether the entry was re-dated and the date it
 * actually posted under, so the move isn't silent.
 */
export async function postInOpenPeriod(
  db: DB,
  input: Omit<PostEntryInput, 'entryDate'>,
  preferredDate: Date,
  detail?: PostInOpenPeriodDetail
): Promise<'posted' | 'closed'> {
  const today = new Date()
  const dates =
    toIsoDate(today) === toIsoDate(preferredDate) ? [preferredDate] : [preferredDate, today]
  for (let i = 0; i < dates.length; i++) {
    try {
      await postJournalEntry(db, { ...input, entryDate: dates[i] })
      if (detail) {
        detail.redated = i > 0
        detail.postedDate = dates[i]
      }
      return 'posted'
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).toLowerCase()
      if ((msg.includes('period') || msg.includes('closed')) && i < dates.length - 1) continue
      if (msg.includes('period') || msg.includes('closed')) {
        if (detail) {
          detail.redated = false
          detail.postedDate = null
        }
        return 'closed'
      }
      throw e
    }
  }
  if (detail) {
    detail.redated = false
    detail.postedDate = null
  }
  return 'closed'
}
