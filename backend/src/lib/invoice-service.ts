/**
 * invoice-service.ts — Phase 2.
 *
 * Drives the draft → issued → void invoice lifecycle. Wraps `gl-service` so
 * every state change is paired with a balanced journal entry inside one DB
 * transaction.
 *
 * Conventions:
 *  - Money math goes through `Money` to keep cent-exact totals.
 *  - The entire `tax_total` is posted to a single configurable tax account
 *    (default `2300 VAT Payable`). Phase 8 hardening can split by VAT / NHIL /
 *    GETFund once tax_calculations.* per-line is wired in.
 *  - Discount uses the spec's "contra-revenue" treatment: gross revenue is
 *    credited at `line_subtotal`, and `4900 Discounts Given` is debited for
 *    the discount portion. The accounting equation still nets to
 *    `line_after_discount`.
 */

import { Money } from '@denel/utils'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { DB } from '../db'
import { accounts, invoiceLines, invoices, specialistCommissions } from '../db/schema'
import {
  buildAccrualJournalLines,
  computeAccrualsForInvoice,
  recordAccrualRows,
  reverseForInvoice,
} from './commission-service'
import { lockInvoice } from './db-locks'
import { reverseEventsForInvoice } from './deferred-revenue-service'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import {
  type JournalLineInput,
  loadPostedEntry,
  type PostedEntry,
  postJournalEntry,
  reverseJournalEntry,
} from './gl-service'
import { writeTimeline } from './ledger-service'
import { applyDelta } from './patient-ar-service'

export type IssueInvoiceResult = {
  invoice: typeof invoices.$inferSelect
  journalEntry: PostedEntry
}

/** The per-line money columns a header total is derived from. */
type InvoiceLineTotals = {
  lineSubtotal: number | string
  surchargeAmount: number | string
  discountAmount: number | string
  lineAfterDiscount: number | string
  taxAmount: number | string
  lineTotal: number | string
}

export type InvoiceTotals = {
  subtotal: Money
  surchargeTotal: Money
  discountTotal: Money
  taxableAmount: Money
  taxTotal: Money
  total: Money
}

/**
 * D5: the ONE way to total an invoice from its lines. Both `issueInvoice()`
 * (draft → issued) and `recomputeInvoiceTotals()` (every draft line write) go
 * through this, so a draft header and the issued header can never describe two
 * different documents.
 */
export function sumInvoiceLines(lines: readonly InvoiceLineTotals[]): InvoiceTotals {
  let subtotal = Money.zero()
  let surchargeTotal = Money.zero()
  let discountTotal = Money.zero()
  let taxableAmount = Money.zero()
  let taxTotal = Money.zero()
  let total = Money.zero()
  for (const line of lines) {
    subtotal = subtotal.add(line.lineSubtotal)
    surchargeTotal = surchargeTotal.add(line.surchargeAmount)
    discountTotal = discountTotal.add(line.discountAmount)
    taxableAmount = taxableAmount.add(line.lineAfterDiscount)
    taxTotal = taxTotal.add(line.taxAmount)
    total = total.add(line.lineTotal)
  }
  return { subtotal, surchargeTotal, discountTotal, taxableAmount, taxTotal, total }
}

/**
 * The `invoices` column patch for a set of summed totals. `amount` and
 * `balance` mirror `total` — the same shape `issueInvoice()` persists. A draft
 * cannot carry `paid_amount > 0` (allocating a payment flips the status off
 * `draft`, and the line routes reject anything non-draft), so `balance = total`
 * holds for both callers.
 */
export function invoiceTotalsColumns(totals: InvoiceTotals) {
  return {
    subtotal: totals.subtotal.toDbValue(),
    surchargeTotal: totals.surchargeTotal.toDbValue(),
    discountTotal: totals.discountTotal.toDbValue(),
    taxableAmount: totals.taxableAmount.toDbValue(),
    taxTotal: totals.taxTotal.toDbValue(),
    total: totals.total.toDbValue(),
    amount: totals.total.toDbValue(),
    balance: totals.total.toDbValue(),
  }
}

/**
 * D5: re-derive a draft invoice's header money columns from its lines and
 * persist them. Called after every line insert / delete so `invoice.total` is
 * never a stale, authoritative-looking `0`. An invoice with no lines correctly
 * totals to zero.
 *
 * MUST be called inside the same transaction as the line write (and after
 * `lockInvoice`) so a concurrent line write can't clobber the recomputation.
 */
export async function recomputeInvoiceTotals(tx: DB, invoiceId: string): Promise<InvoiceTotals> {
  const lines = await tx.query.invoiceLines.findMany({
    where: eq(invoiceLines.invoiceId, invoiceId),
    columns: {
      lineSubtotal: true,
      surchargeAmount: true,
      discountAmount: true,
      lineAfterDiscount: true,
      taxAmount: true,
      lineTotal: true,
    },
  })
  const totals = sumInvoiceLines(lines)
  await tx
    .update(invoices)
    .set({ ...invoiceTotalsColumns(totals), updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId))
  return totals
}

export async function issueInvoice(
  db: DB,
  invoiceId: string,
  userId: string,
  opts: { entryDate?: Date } = {}
): Promise<IssueInvoiceResult> {
  return db.transaction(async (tx) => {
    // Lock the invoice row so a concurrent issue / void can't race the
    // draft → issued transition and double-post the JE (C3).
    const invoice = await lockInvoice(tx, invoiceId)
    if (!invoice) throw new Error(`invoice ${invoiceId} not found`)

    // Idempotent: already issued returns the existing JE.
    if (invoice.journalEntryId) {
      const existing = await loadPostedEntry(tx, invoice.journalEntryId)
      if (existing) return { invoice, journalEntry: existing }
    }

    if (invoice.status !== 'draft') {
      throw new Error(`invoice ${invoice.invoiceNumber} is ${invoice.status}, not draft`)
    }

    const lines = await tx.query.invoiceLines.findMany({
      where: eq(invoiceLines.invoiceId, invoiceId),
      orderBy: [asc(invoiceLines.lineNumber)],
    })
    if (lines.length === 0) {
      throw new Error(`invoice ${invoice.invoiceNumber} has no lines`)
    }

    // Reject if any line is missing a revenue account (defensive — schema
    // enforces NOT NULL). This is a JE precondition, not a totalling concern.
    for (const line of lines) {
      if (!line.revenueAccountId) {
        throw new Error(`invoice line ${line.lineNumber} missing revenue_account_id`)
      }
    }

    // Recompute totals from lines authoritatively, through the same helper the
    // draft line routes use (D5) — one summation, one contract.
    const totals = sumInvoiceLines(lines)
    const { discountTotal, taxTotal, total } = totals

    // Look up GL accounts once. For specialist-billed invoices the AR
    // control account is 1220 (AR — Specialists); patient-billed uses 1200.
    const isSpecialistBilled = invoice.billToType === 'specialist'
    const codes = [
      FINANCE_ACCOUNTS.AR,
      FINANCE_ACCOUNTS.AR_SPECIALISTS,
      FINANCE_ACCOUNTS.DISCOUNTS_GIVEN,
      FINANCE_ACCOUNTS.TAX_PAYABLE,
      FINANCE_ACCOUNTS.DEFERRED_REVENUE,
    ]
    const acctRows = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(inArray(accounts.code, codes))
    const byCode = new Map(acctRows.map((a) => [a.code, a.id]))
    const arAccountId = byCode.get(
      isSpecialistBilled ? FINANCE_ACCOUNTS.AR_SPECIALISTS : FINANCE_ACCOUNTS.AR
    )
    const discountAccountId = byCode.get(FINANCE_ACCOUNTS.DISCOUNTS_GIVEN)
    const taxAccountId = byCode.get(FINANCE_ACCOUNTS.TAX_PAYABLE)
    const deferredAccountId = byCode.get(FINANCE_ACCOUNTS.DEFERRED_REVENUE)
    if (!arAccountId || !discountAccountId || !taxAccountId) {
      throw new Error('CoA seed missing required accounts (1200/1220, 4900, or 2300)')
    }
    // Note: 2400 Deferred Revenue is optional — only required if any line has
    // defer_revenue=true. Checked below.

    // Build the journal entry:
    //   DR AR (patient)                            total
    //   CR Revenue (per line)                      line_subtotal each
    //   DR Discounts Given (contra-revenue)        sum(discount_amount)
    //   CR Tax Payable                             tax_total
    const journalLineInputs: JournalLineInput[] = []

    // Bill-to party for the AR sub-ledger: patient (default) or specialist
    // (Phase 3 — external lab cases billed to the referring doctor).
    const billToType = invoice.billToType === 'specialist' ? 'specialist' : 'patient'
    const billToPartyId =
      billToType === 'specialist' ? invoice.billToSpecialistId : invoice.patientId
    if (!billToPartyId) {
      throw new Error(
        `invoice ${invoice.invoiceNumber} has billToType=${billToType} but no party id`
      )
    }
    journalLineInputs.push({
      accountId: arAccountId,
      debit: total,
      partyType: billToType,
      partyId: billToPartyId,
      description: `Invoice ${invoice.invoiceNumber}`,
    })

    for (const line of lines) {
      const lineSubtotal = Money.from(line.lineSubtotal)
      const surchargeAmount = Money.from(line.surchargeAmount)
      // Surcharge is ordinary revenue on the same line/account — it doesn't get
      // its own contra account the way discount does, since it's just "charged
      // more for this service," not a separate class of transaction.
      const lineRevenue = lineSubtotal.add(surchargeAmount)
      if (lineRevenue.isZero()) {
        // M9: a zero-revenue line contributes no revenue line to the JE — so
        // it must also carry zero discount / tax / total, otherwise the header
        // totals (which the first loop summed from *every* line) and the JE
        // would describe two different documents.
        if (
          !Money.from(line.discountAmount).isZero() ||
          !Money.from(line.taxAmount).isZero() ||
          !Money.from(line.lineTotal).isZero()
        ) {
          throw new Error(
            `invoice line ${line.lineNumber} has zero subtotal but non-zero discount/tax/total`
          )
        }
        continue
      }
      // Deferred lines credit 2400 Deferred Revenue instead of the normal
      // revenue account. The line's `revenue_account_id` is retained for the
      // eventual reclassification entries (see `deferred-revenue-service`).
      // Discount portion is still reflected via the contra entry on 4900;
      // taxable_amount semantics are unchanged.
      let creditAccountId = line.revenueAccountId
      if (line.deferRevenue) {
        if (!deferredAccountId) {
          throw new Error('CoA seed missing 2400 Deferred Revenue — run migration 0041')
        }
        creditAccountId = deferredAccountId
      }
      journalLineInputs.push({
        accountId: creditAccountId,
        credit: lineRevenue,
        description: line.deferRevenue ? `${line.description} (deferred)` : line.description,
      })
    }

    if (discountTotal.isPositive()) {
      journalLineInputs.push({
        accountId: discountAccountId,
        debit: discountTotal,
        description: 'Discounts given on issue',
      })
    }

    if (taxTotal.isPositive()) {
      journalLineInputs.push({
        accountId: taxAccountId,
        credit: taxTotal,
        description: 'Tax payable on issue',
      })
    }

    // Specialist commission accruals (DR 5110 / CR 2100 per specialist).
    const accruals = await computeAccrualsForInvoice(tx, invoiceId)
    const commissionLines = await buildAccrualJournalLines(tx, accruals)
    journalLineInputs.push(...commissionLines)

    const entryDate = opts.entryDate ?? new Date()
    const entry = await postJournalEntry(tx, {
      entryDate,
      sourceDocType: 'invoice',
      sourceDocId: invoice.id,
      description: `Invoice ${invoice.invoiceNumber}`,
      lines: journalLineInputs,
      createdBy: userId,
    })

    // Insert specialist_commissions rows and bump specialist_balances.accrued.
    if (accruals.length > 0) {
      await recordAccrualRows(tx, invoiceId, accruals)
    }

    // Update invoice header.
    const [updated] = await tx
      .update(invoices)
      .set({
        status: 'issued',
        ...invoiceTotalsColumns(totals),
        journalEntryId: entry.id,
        issuedAt: new Date(),
        issueDate: entryDate.toISOString().slice(0, 10),
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId))
      .returning()

    // Bump AR sub-ledger. Only relevant for patient-billed invoices — the
    // patient_balances / patient_timeline tables are patient-scoped. Specialist
    // debtors live in their own ledger via the GL party_type tagging only.
    if (invoice.patientId) {
      await applyDelta(tx, invoice.patientId, { ar: total })

      await writeTimeline(
        tx,
        invoice.patientId,
        'invoice_issued',
        `Invoice ${invoice.invoiceNumber} issued — ${total.toString()} ${invoice.currency ?? 'GHS'}`,
        {
          referenceType: 'invoice',
          referenceId: invoice.id,
          amount: total.toDbValue(),
          createdById: userId,
        }
      )
    }

    return { invoice: updated, journalEntry: entry }
  })
}

export async function voidInvoice(
  db: DB,
  invoiceId: string,
  opts: { userId: string; reason: string }
): Promise<{ invoice: typeof invoices.$inferSelect; reversal: PostedEntry | null }> {
  return db.transaction(async (tx) => {
    // Lock the invoice row so the void is atomic against any concurrent
    // payment/credit-note posting touching the same invoice (C3).
    const invoice = await lockInvoice(tx, invoiceId)
    if (!invoice) throw new Error(`invoice ${invoiceId} not found`)
    if (invoice.status === 'void') {
      throw new Error(`invoice ${invoice.invoiceNumber} is already void`)
    }
    if (invoice.status === 'draft') {
      // Drafts have no GL impact — just mark as void without a reversal.
      const [updated] = await tx
        .update(invoices)
        .set({
          status: 'void',
          voidedAt: new Date(),
          voidedBy: opts.userId,
          voidReason: opts.reason,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoiceId))
        .returning()
      // L21: drafts have no GL entry to reverse — `reversal` is honestly null,
      // not a `PostedEntry` cast through `as unknown`.
      return { invoice: updated, reversal: null }
    }

    // H8: block voiding once anything has touched the invoice. The old guard
    // tested `balance < amount` — both `balance` and `amount` are derived,
    // drift-prone columns, so it could miss a paid invoice whose `balance`
    // hadn't been recomputed. `paidAmount > 0` is the direct "cash applied"
    // signal; `balance !== total` additionally catches credit notes and any
    // reconciliation drift. A touched invoice is corrected with a credit note,
    // never a void.
    if (Number(invoice.paidAmount) > 0) {
      throw new Error(
        `invoice ${invoice.invoiceNumber} has payments applied — use a credit note instead of void`
      )
    }
    if (!Money.from(invoice.balance).eq(Money.from(invoice.total))) {
      throw new Error(
        `invoice ${invoice.invoiceNumber} balance no longer equals its total (credit note or drift) — use a credit note instead of void`
      )
    }

    // C5: a void posts a blanket reversal of the invoice JE, which also
    // reverses the commission-accrual lines. If any commission on this invoice
    // has already been PAID OUT, that reversal would drift the commission
    // sub-ledger against cash that is already gone. Block it — correct the
    // invoice with a credit note instead.
    const paidCommission = await tx
      .select({ id: specialistCommissions.id })
      .from(specialistCommissions)
      .where(
        and(
          eq(specialistCommissions.invoiceId, invoice.id),
          eq(specialistCommissions.status, 'paid')
        )
      )
      .limit(1)
    if (paidCommission.length > 0) {
      throw new Error(
        `invoice ${invoice.invoiceNumber} has paid specialist commissions — use a credit note instead of void`
      )
    }

    if (!invoice.journalEntryId) {
      throw new Error(`invoice ${invoice.invoiceNumber} has no journal entry to reverse`)
    }

    const reversal = await reverseJournalEntry(tx, invoice.journalEntryId, {
      createdBy: opts.userId,
      description: `Void: ${opts.reason}`,
    })

    const [updated] = await tx
      .update(invoices)
      .set({
        status: 'void',
        balance: 0,
        voidedAt: new Date(),
        voidedBy: opts.userId,
        voidReason: opts.reason,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId))
      .returning()

    // AR sub-ledger reversal — only relevant for patient-billed invoices.
    // Specialist-debtor invoices live in the GL party_type ledger only.
    if (invoice.patientId) {
      await applyDelta(tx, invoice.patientId, { ar: Money.from(invoice.total).neg() })
    }

    // Reverse any specialist commissions accrued on this invoice.
    await reverseForInvoice(tx, invoice.id)

    // H9: reverse any deferred-revenue recognition events on this invoice's
    // lines. The invoice-JE reversal above already backed out the original
    // `CR 2400` posted at issue; this backs out every recognition event's
    // `DR 2400 / CR Revenue` so account 2400 nets to zero for the void.
    await reverseEventsForInvoice(tx, invoice.id, opts.userId)

    if (invoice.patientId) {
      await writeTimeline(
        tx,
        invoice.patientId,
        'note',
        `Invoice ${invoice.invoiceNumber} voided`,
        {
          referenceType: 'invoice',
          referenceId: invoice.id,
          amount: Number(invoice.total),
          description: opts.reason,
          createdById: opts.userId,
        }
      )
    }

    return { invoice: updated, reversal }
  })
}

/**
 * Compute line totals from inputs. Used by the invoice-line creation route
 * so the client doesn't have to do the math.
 */
export function computeLine(input: {
  quantity: number | string
  unitPrice: number | string
  /**
   * First-unit / additional-unit tariff: the price of each unit after the first. When given, the
   * subtotal is `unitPrice + additionalUnitPrice × (quantity − 1)`; one unit costs `unitPrice`
   * alone. Omit (or null) for the flat `unitPrice × quantity`. Only the catalog-priced paths (estimate,
   * walk-in) pass it; a manual line add never does.
   */
  additionalUnitPrice?: number | string | null
  surchargeType?: 'none' | 'percent' | 'amount'
  surchargeValue?: number | string
  discountType?: 'none' | 'percent' | 'amount'
  discountValue?: number | string
  taxRate?: number | string
}): {
  quantity: number
  unitPrice: number
  surchargeAmount: number
  discountAmount: number
  lineSubtotal: number
  lineAfterDiscount: number
  taxAmount: number
  lineTotal: number
} {
  const quantity = Number(input.quantity)
  const unitPrice = Money.from(input.unitPrice)
  const surchargeType = input.surchargeType ?? 'none'
  const surchargeValue = Number(input.surchargeValue ?? 0)
  const discountType = input.discountType ?? 'none'
  const discountValue = Number(input.discountValue ?? 0)
  const taxRate = Number(input.taxRate ?? 0)

  // 0215: surcharge applies to the catalog subtotal first, then discount nets
  // against the (possibly surcharged) gross — so "10% off" after a surcharge
  // reduces the surcharged total, not just the base price. Unlike discount,
  // surcharge has no self-cap: it's additive, not a percentage of itself.
  const additionalUnitPrice =
    input.additionalUnitPrice == null ? null : Money.from(input.additionalUnitPrice)
  const lineSubtotal =
    additionalUnitPrice && quantity > 1
      ? unitPrice.add(additionalUnitPrice.mul(quantity - 1))
      : unitPrice.mul(quantity)
  let surchargeAmount = Money.zero()
  if (surchargeType === 'percent') surchargeAmount = lineSubtotal.percent(surchargeValue)
  else if (surchargeType === 'amount') surchargeAmount = Money.from(surchargeValue)
  const grossAmount = lineSubtotal.add(surchargeAmount)

  let discountAmount = Money.zero()
  if (discountType === 'percent') discountAmount = grossAmount.percent(discountValue)
  else if (discountType === 'amount') discountAmount = Money.from(discountValue)
  if (discountAmount.gt(grossAmount)) discountAmount = grossAmount
  const lineAfterDiscount = grossAmount.sub(discountAmount)
  const taxAmount = lineAfterDiscount.percent(taxRate)
  const lineTotal = lineAfterDiscount.add(taxAmount)

  // Cents in, cents out. Every field below lands in an `invoice_lines` integer
  // column, and callers fold them straight into `Money` accumulators — so this
  // must emit cents (`toDbValue`), not cedis (`toNumber`).
  return {
    quantity,
    unitPrice: unitPrice.toDbValue(),
    surchargeAmount: surchargeAmount.toDbValue(),
    discountAmount: discountAmount.toDbValue(),
    lineSubtotal: lineSubtotal.toDbValue(),
    lineAfterDiscount: lineAfterDiscount.toDbValue(),
    taxAmount: taxAmount.toDbValue(),
    lineTotal: lineTotal.toDbValue(),
  }
}
