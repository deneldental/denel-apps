/**
 * credit-note-service.ts — Phase 4.
 *
 * Drives the draft → posted → void credit-note lifecycle. A credit note
 * reduces a previously issued invoice without cash movement. The journal
 * entry depends on the reason:
 *
 *   discount / cancellation / goodwill / correction:
 *     DR  4xxx Revenue (per line, or 4900 Discounts Given for full credit)
 *     DR  2300 Tax Payable                   (proportional tax reversal)
 *     CR  1200 Accounts Receivable (patient)
 *
 *   write_off:
 *     DR  5900 Bad Debt Expense
 *     CR  1200 Accounts Receivable (patient)
 *
 * Tax is reversed proportionally to the credited fraction of the invoice
 * total: tax_reversed = invoice.taxTotal * (credit_amount / invoice.total).
 * Caller can opt-out by passing `includeTaxReversal: false` (used when the
 * tax authority refuses recovery on cancellations).
 */

import { Money, type MoneyLike } from '@denel/utils'
import { eq, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { creditNoteLines, creditNotes, invoiceLines, invoices, journalLines } from '../db/schema'
import { getAccountByCode } from './channel-accounts'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import {
  type JournalLineInput,
  loadPostedEntry,
  type PostedEntry,
  postJournalEntry,
  reverseJournalEntry,
} from './gl-service'
import { creditWallet, debitWallet, writeTimeline } from './ledger-service'
import { applyDelta } from './patient-ar-service'
import { nextNumber } from './sequence-service'

export type CreditNoteReason = 'discount' | 'correction' | 'cancellation' | 'goodwill' | 'write_off'

export type CreditNoteLineInput = {
  invoiceLineId?: string | null
  amount: MoneyLike
  revenueAccountId?: string | null // defaults to 4900 for discount, original line revenue for line-targeted credits
  description?: string | null
}

export type CreateCreditNoteInput = {
  invoiceId: string
  reason: CreditNoteReason
  amount?: MoneyLike // total — required when no lines provided
  reasonNotes?: string | null
  issueDate?: Date
  lines?: CreditNoteLineInput[]
  includeTaxReversal?: boolean
}

export async function createDraftCreditNote(
  db: DB,
  input: CreateCreditNoteInput,
  userId: string
): Promise<typeof creditNotes.$inferSelect> {
  return db.transaction(async (tx) => {
    const invoice = await tx.query.invoices.findFirst({ where: eq(invoices.id, input.invoiceId) })
    if (!invoice) throw new Error(`invoice ${input.invoiceId} not found`)
    if (invoice.status === 'draft') {
      throw new Error('cannot credit a draft invoice — void it instead')
    }
    if (invoice.status === 'void') throw new Error('invoice is void')

    // Determine the total amount.
    let total: Money
    if (input.lines && input.lines.length > 0) {
      total = Money.sum(input.lines.map((l) => l.amount))
    } else {
      if (input.amount === undefined) {
        throw new Error('amount or lines must be provided')
      }
      total = Money.from(input.amount)
    }
    if (!total.isPositive()) throw new Error('credit note amount must be positive')

    // Cap: existing posted credit notes + this new one cannot exceed invoice.total.
    const priorRows = await tx
      .select({ sum: sql<string | null>`COALESCE(SUM(${creditNotes.amount}), 0)` })
      .from(creditNotes)
      .where(sql`${creditNotes.invoiceId} = ${invoice.id} AND ${creditNotes.status} = 'posted'`)
    const prior = Money.fromDb(priorRows[0]?.sum ?? '0')
    const invoiceTotal = Money.from(invoice.total)
    if (prior.add(total).gt(invoiceTotal)) {
      throw new Error(
        `credit notes (${prior.add(total).toString()}) would exceed invoice total (${invoiceTotal.toString()})`
      )
    }

    // Credit notes are currently patient-scoped; specialist-billed invoices
    // (Phase 3 external lab cases) can't receive credit notes via this path.
    if (!invoice.patientId) {
      throw new Error(
        `Credit notes against specialist-billed invoices are not supported (invoice ${invoice.invoiceNumber})`
      )
    }
    const creditNoteNumber = await nextNumber(tx, 'credit_note', input.issueDate ?? new Date())
    const [creditNote] = await tx
      .insert(creditNotes)
      .values({
        creditNoteNumber,
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        issueDate: (input.issueDate ?? new Date()).toISOString().slice(0, 10),
        reason: input.reason,
        reasonNotes: input.reasonNotes ?? null,
        amount: total.toDbValue(),
        status: 'draft',
        createdBy: userId,
      })
      .returning()

    // Insert line rows if provided. If not, leave lines empty; the post
    // helper falls back to a single line against `4900` (or `5900` for
    // write_off) at the credit note's full amount.
    if (input.lines && input.lines.length > 0) {
      // Pre-resolve default revenue accounts.
      const defaultRevAcct = await getDefaultRevenueAccountId(tx, input.reason)
      for (const line of input.lines) {
        const lineAmount = Money.from(line.amount)
        let revenueAccountId = line.revenueAccountId
        if (!revenueAccountId && line.invoiceLineId) {
          const il = await tx.query.invoiceLines.findFirst({
            where: eq(invoiceLines.id, line.invoiceLineId),
          })
          revenueAccountId = il?.revenueAccountId ?? null
        }
        revenueAccountId ??= defaultRevAcct
        await tx.insert(creditNoteLines).values({
          creditNoteId: creditNote.id,
          invoiceLineId: line.invoiceLineId ?? null,
          amount: lineAmount.toDbValue(),
          revenueAccountId,
          description: line.description ?? null,
        })
      }
    }

    return creditNote
  })
}

export async function postCreditNote(
  db: DB,
  creditNoteId: string,
  userId: string,
  opts: { includeTaxReversal?: boolean } = {}
): Promise<{ creditNote: typeof creditNotes.$inferSelect; journalEntry: PostedEntry }> {
  return db.transaction(async (tx) => {
    const cn = await tx.query.creditNotes.findFirst({ where: eq(creditNotes.id, creditNoteId) })
    if (!cn) throw new Error(`credit note ${creditNoteId} not found`)

    // Idempotent.
    if (cn.journalEntryId) {
      const existing = await loadPostedEntry(tx, cn.journalEntryId)
      if (existing) return { creditNote: cn, journalEntry: existing }
    }
    if (cn.status !== 'draft') {
      throw new Error(`credit note ${cn.creditNoteNumber} is ${cn.status}, not draft`)
    }

    const invoice = await tx.query.invoices.findFirst({ where: eq(invoices.id, cn.invoiceId) })
    if (!invoice) throw new Error(`invoice ${cn.invoiceId} not found`)

    const total = Money.from(cn.amount)
    const arAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.AR)
    const lines = await tx.query.creditNoteLines.findMany({
      where: eq(creditNoteLines.creditNoteId, cn.id),
    })

    // Build debit lines.
    const journalLineInputs: JournalLineInput[] = []
    if (cn.reason === 'write_off') {
      const badDebt = await getAccountByCode(tx, FINANCE_ACCOUNTS.BAD_DEBT_EXPENSE)
      journalLineInputs.push({
        accountId: badDebt.id,
        debit: total,
        description: `Write-off: invoice ${invoice.invoiceNumber}`,
      })
    } else if (lines.length > 0) {
      for (const line of lines) {
        journalLineInputs.push({
          accountId: line.revenueAccountId,
          debit: Money.from(line.amount),
          description: line.description ?? `Credit invoice ${invoice.invoiceNumber}`,
        })
      }
    } else {
      const defaultRev = await getDefaultRevenueAccount(tx, cn.reason as CreditNoteReason)
      journalLineInputs.push({
        accountId: defaultRev.id,
        debit: total,
        description: `${cn.reason}: invoice ${invoice.invoiceNumber}`,
      })
    }

    // Optional proportional tax reversal.
    const invoiceTotal = Money.from(invoice.total)
    const invoiceTax = Money.from(invoice.taxTotal)
    let arCredit = total
    if (
      opts.includeTaxReversal !== false &&
      invoiceTax.isPositive() &&
      invoiceTotal.isPositive() &&
      cn.reason !== 'write_off'
    ) {
      // tax_reversed = invoiceTax * (creditAmount / invoiceTotal), exact.
      const taxReversed = invoiceTax.proportion(total, invoiceTotal)
      if (taxReversed.isPositive()) {
        const taxAcct = await getAccountByCode(tx, FINANCE_ACCOUNTS.TAX_PAYABLE)
        journalLineInputs.push({
          accountId: taxAcct.id,
          debit: taxReversed,
          description: 'Tax reversal',
        })
        arCredit = total.add(taxReversed)
      }
    }

    // H10: a credit note can be worth more than the invoice's outstanding
    // balance — the invoice may have been partly or fully paid first. Only the
    // balance-covering portion settles AR; the excess is the patient's money
    // back, so it lands in 2200 Patient Deposits (their wallet) rather than
    // being credited to AR (which would leave the patient with negative AR and
    // drift the sub-ledger).
    const invoiceBalance = Money.from(invoice.balance)
    const arToInvoice = arCredit.gt(invoiceBalance) ? invoiceBalance : arCredit
    const depositExcess = arCredit.sub(arToInvoice)

    if (arToInvoice.isPositive()) {
      journalLineInputs.push({
        accountId: arAccount.id,
        credit: arToInvoice,
        partyType: 'patient',
        partyId: cn.patientId,
        description: `Credit note ${cn.creditNoteNumber}`,
      })
    }
    if (depositExcess.isPositive()) {
      const depositsAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.PATIENT_DEPOSITS)
      journalLineInputs.push({
        accountId: depositsAccount.id,
        credit: depositExcess,
        partyType: 'patient',
        partyId: cn.patientId,
        description: `Credit note ${cn.creditNoteNumber} — excess to patient deposit`,
      })
    }

    const entry = await postJournalEntry(tx, {
      entryDate: new Date(cn.issueDate),
      sourceDocType: 'credit_note',
      sourceDocId: cn.id,
      description: `Credit note ${cn.creditNoteNumber}: ${cn.reason}`,
      lines: journalLineInputs,
      createdBy: userId,
    })

    // Reduce the invoice balance by the AR-settling portion only — never below
    // zero. If it reaches zero, mark paid (or written_off for a write-off).
    const balanceClamped = invoiceBalance.sub(arToInvoice)
    let newStatus = invoice.status
    if (balanceClamped.isZero()) {
      newStatus = cn.reason === 'write_off' ? 'written_off' : 'paid'
    } else if (newStatus === 'issued' && Number(invoice.paidAmount) > 0) {
      newStatus = 'partially_paid'
    }
    await tx
      .update(invoices)
      .set({
        balance: balanceClamped.toDbValue(),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoice.id))

    // The credit reduces patient AR by the settling portion; any excess becomes
    // wallet credit (the 2200 Patient Deposits sub-ledger).
    await applyDelta(tx, cn.patientId, { ar: arToInvoice.neg() })
    if (depositExcess.isPositive()) {
      await creditWallet(
        tx,
        cn.patientId,
        depositExcess.toDbValue(),
        'credit_note',
        cn.id,
        `Credit note ${cn.creditNoteNumber} — excess credit`,
        userId
      )
    }

    const [updated] = await tx
      .update(creditNotes)
      .set({ status: 'posted', journalEntryId: entry.id, postedAt: new Date() })
      .where(eq(creditNotes.id, cn.id))
      .returning()

    await writeTimeline(
      tx,
      cn.patientId,
      'note',
      `Credit note ${cn.creditNoteNumber} (${cn.reason}) — ${total.toString()} GHS`,
      {
        referenceType: 'invoice',
        referenceId: invoice.id,
        amount: total.toDbValue(),
        description: cn.reasonNotes ?? undefined,
        createdById: userId,
      }
    )

    return { creditNote: updated, journalEntry: entry }
  })
}

export async function voidCreditNote(
  db: DB,
  creditNoteId: string,
  opts: { userId: string; reason: string }
): Promise<{ creditNote: typeof creditNotes.$inferSelect; reversal: PostedEntry | null }> {
  return db.transaction(async (tx) => {
    const cn = await tx.query.creditNotes.findFirst({ where: eq(creditNotes.id, creditNoteId) })
    if (!cn) throw new Error(`credit note ${creditNoteId} not found`)
    if (cn.status === 'void') throw new Error('credit note is already void')
    if (cn.status === 'draft') {
      const [updated] = await tx
        .update(creditNotes)
        .set({ status: 'void', voidedAt: new Date(), voidedBy: opts.userId, updatedAt: new Date() })
        .where(eq(creditNotes.id, cn.id))
        .returning()
      return { creditNote: updated, reversal: null }
    }
    if (!cn.journalEntryId) {
      throw new Error('posted credit note has no journal entry to reverse')
    }

    // Recover how the original credit was split (H10): the `CR 1200` portion
    // settled invoice AR, any `CR 2200` portion became wallet credit. Reading
    // the JE lines back is authoritative — the split isn't stored on the
    // credit note itself.
    const arAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.AR)
    const depositsAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.PATIENT_DEPOSITS)
    const originalLines = await tx.query.journalLines.findMany({
      where: eq(journalLines.entryId, cn.journalEntryId),
    })
    let arToInvoice = Money.zero()
    let depositExcess = Money.zero()
    for (const l of originalLines) {
      if (l.accountId === arAccount.id) arToInvoice = arToInvoice.add(l.credit)
      else if (l.accountId === depositsAccount.id) depositExcess = depositExcess.add(l.credit)
    }

    const reversal = await reverseJournalEntry(tx, cn.journalEntryId, {
      createdBy: opts.userId,
      description: `Void credit note ${cn.creditNoteNumber}: ${opts.reason}`,
    })

    const invoice = await tx.query.invoices.findFirst({ where: eq(invoices.id, cn.invoiceId) })
    if (invoice) {
      // Restore only the AR-settling portion to the invoice balance — the
      // deposit-excess portion never touched the invoice.
      const restored = Money.from(invoice.balance).add(arToInvoice)
      const isFull = Money.from(invoice.paidAmount).isZero()
      const newStatus =
        invoice.status === 'paid' || invoice.status === 'written_off'
          ? isFull
            ? 'issued'
            : 'partially_paid'
          : invoice.status
      await tx
        .update(invoices)
        .set({
          balance: restored.toDbValue(),
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoice.id))
    }

    await applyDelta(tx, cn.patientId, { ar: arToInvoice })
    // Reclaim any excess that was credited to the patient's wallet. Allow a
    // partial debit — the patient may already have spent some of it.
    if (depositExcess.isPositive()) {
      await debitWallet(
        tx,
        cn.patientId,
        depositExcess.toDbValue(),
        'credit_note',
        cn.id,
        `Void credit note ${cn.creditNoteNumber} — reclaim excess credit`,
        opts.userId,
        true
      )
    }

    const [updated] = await tx
      .update(creditNotes)
      .set({
        status: 'void',
        voidedAt: new Date(),
        voidedBy: opts.userId,
        reversalJournalEntryId: reversal.id,
        updatedAt: new Date(),
      })
      .where(eq(creditNotes.id, cn.id))
      .returning()

    return { creditNote: updated, reversal }
  })
}

async function getDefaultRevenueAccount(db: DB, reason: CreditNoteReason) {
  if (reason === 'write_off') return getAccountByCode(db, FINANCE_ACCOUNTS.BAD_DEBT_EXPENSE)
  return getAccountByCode(db, FINANCE_ACCOUNTS.DISCOUNTS_GIVEN)
}

async function getDefaultRevenueAccountId(db: DB, reason: CreditNoteReason): Promise<string> {
  const acct = await getDefaultRevenueAccount(db, reason)
  return acct.id
}
