/**
 * ap-service.ts — Phase 6.
 *
 * Drives the supplier-bill lifecycle (draft → posted → paid → void) and the
 * supplier_balances materialized sub-ledger. Wraps `gl-service` so every state
 * change is paired with a balanced journal entry.
 *
 * Post bill:
 *   DR  5xxx Expense account(s) (one DR per line)         line totals
 *   DR  2300 Tax Payable (input VAT, if any)              tax total
 *   CR  2000 Accounts Payable — Supplier (party=supplier) total
 *
 * Outgoing supplier payment (handled in payment-service):
 *   DR  2000 Accounts Payable — Supplier (party=supplier) allocated amount
 *   CR  10xx Cash/Bank                                    amount
 */

import { Money, type MoneyLike } from '@denel/utils'
import { eq, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { billLines, bills, supplierBalances } from '../db/schema'
import { getAccountByCode } from './channel-accounts'
import { lockBill } from './db-locks'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import {
  type JournalLineInput,
  loadPostedEntry,
  type PostedEntry,
  postJournalEntry,
  reverseJournalEntry,
} from './gl-service'
import { nextNumber } from './sequence-service'

/** Default supplier payment terms when a bill doesn't specify a due date. */
const DEFAULT_BILL_TERMS_DAYS = 30

/** Add whole days to a date without mutating the input. */
function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export type BillLineInput = {
  description: string
  quantity?: MoneyLike
  unitPrice: MoneyLike
  taxRate?: number | string
  expenseAccountId: string
}

export type CreateBillInput = {
  supplierId: string
  supplierBillRef?: string | null
  issueDate?: Date
  dueDate?: Date
  notes?: string | null
  lines: BillLineInput[]
}

/**
 * Compute line totals from raw inputs. Caller stores the result on bill_lines.
 */
export function computeBillLine(input: BillLineInput): {
  quantity: number
  unitPrice: number
  taxRate: number
  taxAmount: number
  lineTotal: number
  lineSubtotal: number
} {
  const quantity = Number(input.quantity ?? 1)
  const unitPrice = Money.from(input.unitPrice)
  const taxRate = Number(input.taxRate ?? 0)
  const lineSubtotal = unitPrice.mul(quantity)
  const taxAmount = lineSubtotal.percent(taxRate)
  const lineTotal = lineSubtotal.add(taxAmount)
  // Cents in, cents out — these land on `bill_lines` integer columns.
  return {
    quantity,
    unitPrice: unitPrice.toDbValue(),
    taxRate,
    taxAmount: taxAmount.toDbValue(),
    lineTotal: lineTotal.toDbValue(),
    lineSubtotal: lineSubtotal.toDbValue(),
  }
}

export async function createDraftBill(
  db: DB,
  input: CreateBillInput,
  userId: string
): Promise<typeof bills.$inferSelect> {
  return db.transaction(async (tx) => {
    if (input.lines.length === 0) throw new Error('bill requires at least one line')

    const issueDate = input.issueDate ?? new Date()
    const dueDate = input.dueDate ?? addDays(issueDate, DEFAULT_BILL_TERMS_DAYS)

    let subtotal = Money.zero()
    let taxTotal = Money.zero()
    let total = Money.zero()
    const computed = input.lines.map((line) => {
      const c = computeBillLine(line)
      subtotal = subtotal.add(c.lineSubtotal)
      taxTotal = taxTotal.add(c.taxAmount)
      total = total.add(c.lineTotal)
      return c
    })

    const billNumber = await nextNumber(tx, 'bill', issueDate)

    const [bill] = await tx
      .insert(bills)
      .values({
        billNumber,
        supplierBillRef: input.supplierBillRef ?? null,
        supplierId: input.supplierId,
        issueDate: issueDate.toISOString().slice(0, 10),
        dueDate: dueDate.toISOString().slice(0, 10),
        subtotal: subtotal.toDbValue(),
        taxTotal: taxTotal.toDbValue(),
        total: total.toDbValue(),
        amountPaid: 0,
        balance: total.toDbValue(),
        status: 'draft',
        notes: input.notes ?? null,
        createdBy: userId,
      })
      .returning()

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i]
      const c = computed[i]
      await tx.insert(billLines).values({
        billId: bill.id,
        description: line.description,
        quantity: c.quantity,
        unitPrice: c.unitPrice,
        taxRate: c.taxRate,
        taxAmount: c.taxAmount,
        lineTotal: c.lineTotal,
        expenseAccountId: line.expenseAccountId,
      })
    }

    return bill
  })
}

export async function postBill(
  db: DB,
  billId: string,
  userId: string
): Promise<{ bill: typeof bills.$inferSelect; journalEntry: PostedEntry }> {
  return db.transaction(async (tx) => {
    // Lock the bill row so a concurrent post / void can't race the
    // draft → posted transition and double-post the JE (C3).
    const bill = await lockBill(tx, billId)
    if (!bill) throw new Error(`bill ${billId} not found`)

    // Idempotent: already posted returns existing JE.
    if (bill.journalEntryId) {
      const existing = await loadPostedEntry(tx, bill.journalEntryId)
      if (existing) return { bill, journalEntry: existing }
    }
    if (bill.status !== 'draft') {
      throw new Error(`bill ${bill.billNumber} is ${bill.status}, not draft`)
    }

    const lines = await tx.query.billLines.findMany({
      where: eq(billLines.billId, bill.id),
    })
    if (lines.length === 0) throw new Error('bill has no lines')

    const apAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.AP)

    // Aggregate per-account debits (multiple lines may share one expense account).
    const byAccount = new Map<string, Money>()
    let taxTotal = Money.zero()
    for (const line of lines) {
      const prior = byAccount.get(line.expenseAccountId) ?? Money.zero()
      // Per spec §6.9, expense account is debited with line_subtotal (excluding tax),
      // and tax goes to 2300. We back into line_subtotal from line_total - tax_amount.
      const lineSubtotal = Money.from(line.lineTotal).sub(Money.from(line.taxAmount))
      byAccount.set(line.expenseAccountId, prior.add(lineSubtotal))
      taxTotal = taxTotal.add(line.taxAmount)
    }

    const journalLineInputs: JournalLineInput[] = []
    for (const [accountId, amount] of byAccount.entries()) {
      if (amount.isZero()) continue
      journalLineInputs.push({
        accountId,
        debit: amount,
        description: `Bill ${bill.billNumber}`,
      })
    }
    if (taxTotal.isPositive()) {
      const taxAcct = await getAccountByCode(tx, FINANCE_ACCOUNTS.TAX_PAYABLE)
      journalLineInputs.push({
        accountId: taxAcct.id,
        debit: taxTotal,
        description: 'Input tax on bill',
      })
    }
    journalLineInputs.push({
      accountId: apAccount.id,
      credit: Money.from(bill.total),
      partyType: 'supplier',
      partyId: bill.supplierId,
      description: `AP — bill ${bill.billNumber}`,
    })

    const entry = await postJournalEntry(tx, {
      entryDate: new Date(bill.issueDate),
      sourceDocType: 'bill',
      sourceDocId: bill.id,
      description: `Bill ${bill.billNumber}`,
      lines: journalLineInputs,
      createdBy: userId,
    })

    const [updated] = await tx
      .update(bills)
      .set({
        status: 'posted',
        journalEntryId: entry.id,
        postedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bills.id, bill.id))
      .returning()

    // Bump supplier_balances.ap_balance.
    await applySupplierDelta(tx, bill.supplierId, Money.from(bill.total))

    return { bill: updated, journalEntry: entry }
  })
}

export async function voidBill(
  db: DB,
  billId: string,
  opts: { userId: string; reason: string }
): Promise<{ bill: typeof bills.$inferSelect; reversal: PostedEntry | null }> {
  return db.transaction(async (tx) => {
    // Lock the bill row so the void is atomic against a concurrent payment
    // posting touching the same bill (C3).
    const bill = await lockBill(tx, billId)
    if (!bill) throw new Error(`bill ${billId} not found`)
    if (bill.status === 'void') throw new Error('bill is already void')
    if (bill.status === 'draft') {
      const [updated] = await tx
        .update(bills)
        .set({
          status: 'void',
          voidedAt: new Date(),
          voidedBy: opts.userId,
          voidReason: opts.reason,
          updatedAt: new Date(),
        })
        .where(eq(bills.id, bill.id))
        .returning()
      return { bill: updated, reversal: null }
    }
    if (Number(bill.amountPaid) > 0) {
      throw new Error(
        `bill ${bill.billNumber} has payments — use a credit/debit memo or refund instead`
      )
    }
    if (!bill.journalEntryId) {
      throw new Error('posted bill has no journal entry to reverse')
    }

    const reversal = await reverseJournalEntry(tx, bill.journalEntryId, {
      createdBy: opts.userId,
      description: `Void bill ${bill.billNumber}: ${opts.reason}`,
    })

    const [updated] = await tx
      .update(bills)
      .set({
        status: 'void',
        balance: 0,
        voidedAt: new Date(),
        voidedBy: opts.userId,
        voidReason: opts.reason,
        reversalJournalEntryId: reversal.id,
        updatedAt: new Date(),
      })
      .where(eq(bills.id, bill.id))
      .returning()

    await applySupplierDelta(tx, bill.supplierId, Money.from(bill.total).neg())

    return { bill: updated, reversal }
  })
}

/**
 * Adjust a bill's amount_paid / balance after a payment allocation (positive)
 * or a reversal (negative). Maintains supplier_balances.ap_balance.
 */
export async function applyBillPayment(db: DB, billId: string, delta: MoneyLike): Promise<void> {
  const deltaM = Money.from(delta)
  // Lock the bill row: this is a read-modify-write on `amount_paid` / `balance`,
  // so concurrent payment allocations must be serialized (C3). When called
  // inside a posting transaction the lock is held until that transaction
  // commits; standalone it locks for the statement.
  const bill = await lockBill(db, billId)
  if (!bill) throw new Error(`bill ${billId} not found`)
  const newPaid = Money.from(bill.amountPaid).add(deltaM)
  const newBalance = Money.from(bill.total).sub(newPaid)
  let newStatus = bill.status
  if (newBalance.isZero()) newStatus = 'paid'
  else if (newPaid.isPositive()) newStatus = 'partially_paid'
  else newStatus = 'posted'

  await db
    .update(bills)
    .set({
      amountPaid: newPaid.toDbValue(),
      balance: newBalance.toDbValue(),
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(bills.id, bill.id))

  await applySupplierDelta(db, bill.supplierId, deltaM.neg())
}

/**
 * Apply an additive delta to a supplier's AP balance.
 */
export async function applySupplierDelta(
  db: DB,
  supplierId: string,
  delta: MoneyLike
): Promise<void> {
  const deltaM = Money.from(delta)
  if (deltaM.isZero()) return
  await db
    .insert(supplierBalances)
    .values({ supplierId, apBalance: deltaM.toDbValue() })
    .onConflictDoUpdate({
      target: supplierBalances.supplierId,
      set: {
        apBalance: sql`${supplierBalances.apBalance} + ${deltaM.toDbValue()}`,
        updatedAt: new Date(),
      },
    })
}

/**
 * Authoritative recompute of supplier_balances from the GL. Equivalent to
 * the patient-AR recomputeFromLedger; useful for migration verification.
 */
export async function recomputeSupplierBalances(db: DB): Promise<number> {
  const ap = await db.query.accounts.findFirst({ where: eq(sql`code`, '2000') })
  if (!ap) throw new Error('AP control account (2000) is missing — seed the CoA')

  const rows = await db.execute<{ supplier_id: string; bal: string }>(sql`
    SELECT jl.party_id::text AS supplier_id,
           COALESCE(SUM(jl.credit - jl.debit), 0)::text AS bal
    FROM journal_lines jl
    WHERE jl.account_id = ${ap.id}
      AND jl.party_type = 'supplier'
    GROUP BY jl.party_id
  `)
  // M6: one multi-row upsert instead of an INSERT per supplier.
  const valueRows = rows.rows.map((r) => ({
    supplierId: r.supplier_id,
    apBalance: Number(r.bal),
  }))
  if (valueRows.length === 0) return 0
  await db
    .insert(supplierBalances)
    .values(valueRows)
    .onConflictDoUpdate({
      target: supplierBalances.supplierId,
      set: { apBalance: sql`excluded.ap_balance`, updatedAt: new Date() },
    })
  return valueRows.length
}
