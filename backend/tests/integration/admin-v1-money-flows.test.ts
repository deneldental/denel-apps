/**
 * admin-v1 money-flow smoke tests — the final-verification suite for the Phase 4
 * GL postings (expenses, retail, payroll, insurance, remittances) plus a Phase-2
 * catalog-integrity check.
 *
 * Run with `doppler run -- pnpm --filter backend test` (gated on DATABASE_URL;
 * `pnpm test` alone skips). Every test runs inside `withRollback`, a transaction
 * that is ALWAYS rolled back, so the shared dev DB is never mutated. Each test
 * calls the real service against the sandbox tx and asserts the actual journal
 * lines — proving the books, not just that Money works.
 */

import { randomUUID } from 'node:crypto'
import { Money } from '@denel/utils'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  expenses,
  items,
  journalEntries,
  payrollRuns,
  payslips,
  sales,
  staff,
} from '../../src/db/schema'
import { getAccountByCode } from '../../src/lib/channel-accounts'
import { ensureExpensePosted } from '../../src/lib/expense-service'
import { postInOpenPeriod } from '../../src/lib/gl-service'
import {
  postInsurancePayment,
  postInsuranceReceivable,
  postInsuranceShortfall,
  reverseInsuranceGL,
} from '../../src/lib/insurance-gl-service'
import { postPayrollRunToGL } from '../../src/lib/payroll-gl-service'
import { getOrCreatePeriodFor } from '../../src/lib/period-service'
import { postRetailSaleToGL } from '../../src/lib/retail-service'
import { accountIdByCode, anyUserId } from './_fixtures'
import { noDb, withRollback } from './_setup'

/**
 * withRollback + an OPEN accounting period covering today — every GL post asserts
 * an open period exists for the entry date (assertPeriodOpen does not auto-create).
 */
async function withPostingRollback(fn: (tx: DB) => Promise<void>) {
  await withRollback(async (tx) => {
    await getOrCreatePeriodFor(tx, new Date())
    await fn(tx)
  })
}

// ── helpers ──────────────────────────────────────────────────────────────────

type Line = { accountId: string; debit: number | null; credit: number | null }

/** Load the live (non-reversal) posted entry + its lines for a source doc. */
async function liveEntry(tx: DB, sourceDocType: string, sourceDocId: string) {
  const e = await tx.query.journalEntries.findFirst({
    where: and(
      eq(journalEntries.sourceDocType, sourceDocType as never),
      eq(journalEntries.sourceDocId, sourceDocId),
      eq(journalEntries.isReversal, false)
    ),
    with: { lines: true },
  })
  if (!e) return null
  const lines = (e as unknown as { lines: Line[] }).lines
  return { id: e.id, lines }
}

const sumDebit = (lines: Line[]) => lines.reduce((s, l) => s + Number(l.debit ?? 0), 0)
const sumCredit = (lines: Line[]) => lines.reduce((s, l) => s + Number(l.credit ?? 0), 0)
const debitOn = (lines: Line[], accountId: string) =>
  lines.filter((l) => l.accountId === accountId).reduce((s, l) => s + Number(l.debit ?? 0), 0)
const creditOn = (lines: Line[], accountId: string) =>
  lines.filter((l) => l.accountId === accountId).reduce((s, l) => s + Number(l.credit ?? 0), 0)

/** Assert sum(debits) == sum(credits) to the cent. */
function expectBalanced(lines: Line[]) {
  expect(Money.from(sumDebit(lines)).eq(Money.from(sumCredit(lines)))).toBe(true)
}

// ── Expense → GL ─────────────────────────────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §F — expense posts to the books', () => {
  it('a paid expense posts DR expense / CR cash, balanced', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const expenseAcct = await accountIdByCode(tx, '5000') // any seeded expense account
      const cashAcct = await accountIdByCode(tx, '1000')

      const [exp] = await tx
        .insert(expenses)
        .values({
          category: 'IT Test Expense',
          amount: 150,
          status: 'paid',
          paymentMethod: 'cash',
          accountId: expenseAcct,
          createdById: userId,
        })
        .returning()

      const res = await ensureExpensePosted(tx, exp, userId)
      expect(res.posted).toBe(true)

      const entry = await liveEntry(tx, 'expense', exp.id)
      expect(entry).not.toBeNull()
      if (!entry) return
      expectBalanced(entry.lines)
      expect(debitOn(entry.lines, expenseAcct)).toBe(150)
      expect(creditOn(entry.lines, cashAcct)).toBe(150)
    })
  })

  it('is idempotent — posting twice yields one entry', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const expenseAcct = await accountIdByCode(tx, '5000')
      const [exp] = await tx
        .insert(expenses)
        .values({
          category: 'IT Test Expense',
          amount: 90,
          status: 'paid',
          paymentMethod: 'cash',
          accountId: expenseAcct,
          createdById: userId,
        })
        .returning()
      await ensureExpensePosted(tx, exp, userId)
      await ensureExpensePosted(tx, exp, userId)
      const all = await tx.query.journalEntries.findMany({
        where: and(
          eq(journalEntries.sourceDocType, 'expense' as never),
          eq(journalEntries.sourceDocId, exp.id)
        ),
      })
      expect(all.length).toBe(1)
    })
  })
})

// ── Retail sale → GL ─────────────────────────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §12.2 — retail sale posts to the books', () => {
  it('a submitted store sale posts DR cash / CR retail revenue (4200)', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const cashAcct = await accountIdByCode(tx, '1000')
      const retailRev = await accountIdByCode(tx, '4200')

      const [item] = await tx
        .insert(items)
        .values({ name: `IT Item ${randomUUID().slice(0, 8)}`, sellable: true, price: 40 })
        .returning()
      const [sale] = await tx
        .insert(sales)
        .values({
          itemId: item.id,
          quantity: 2,
          unitPrice: 40,
          costPrice: 25,
          totalAmount: 80,
          profit: 30,
          status: 'submitted',
        })
        .returning()

      const res = await postRetailSaleToGL(tx, sale, userId, new Date())
      expect(res.posted).toBe(true)

      const entry = await liveEntry(tx, 'retail_sale', sale.id)
      expect(entry).not.toBeNull()
      if (!entry) return
      expectBalanced(entry.lines)
      expect(debitOn(entry.lines, cashAcct)).toBe(80)
      expect(creditOn(entry.lines, retailRev)).toBe(80)
    })
  })

  it('a draft (not submitted) sale does not post', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const [item] = await tx
        .insert(items)
        .values({ name: `IT Item ${randomUUID().slice(0, 8)}`, sellable: true, price: 10 })
        .returning()
      const [sale] = await tx
        .insert(sales)
        .values({
          itemId: item.id,
          quantity: 1,
          unitPrice: 10,
          costPrice: 5,
          totalAmount: 10,
          profit: 5,
          status: 'draft',
        })
        .returning()
      const res = await postRetailSaleToGL(tx, sale, userId, new Date())
      expect(res.posted).toBe(false)
      expect(res.reason).toBe('not_submitted')
    })
  })
})

// ── Payroll run → GL ─────────────────────────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §14.1 — payroll run posts to the books', () => {
  it('posts a balanced DR salaries+employer-SSNIT / CR PAYE+SSNIT+net entry', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const salaries = await accountIdByCode(tx, '5100')
      // HR-H9: publish ACCRUES net pay to 2350 Net Salaries Payable — Bank only
      // moves at disbursement (POST /runs/:id/pay), so nothing credits 1010 here.
      const netPayable = await accountIdByCode(tx, '2350')
      const paye = await accountIdByCode(tx, '2330')

      const [staffRow] = await tx
        .insert(staff)
        .values({
          staffId: `IT-${randomUUID().slice(0, 8)}`,
          fullName: 'IT Staff',
          employmentType: 'permanent',
        })
        .returning()

      const now = new Date()
      const [run] = await tx
        .insert(payrollRuns)
        .values({
          name: 'IT Payroll',
          payPeriodStart: now,
          payPeriodEnd: now,
          status: 'locked',
        })
        .returning()

      // gross = paye + ssnit_employee + net → GHS 1000 = 120 + 55 + 825 (balances).
      // grossPay/netPay are CENT columns; the deductions JSONB stays in CEDIS
      // (see payroll-gl-service.ts), so the two units sit side by side here on
      // purpose — that mismatch is exactly what the posting has to reconcile.
      await tx.insert(payslips).values({
        staffId: staffRow.id,
        payPeriod: now.toISOString().slice(0, 10),
        grossPay: 100000,
        netPay: 82500,
        deductions: { paye: 120, ssnit_employee: 55, ssnit_employer: 130 } as never,
        payrollRunId: run.id,
        status: 'draft',
      })

      const res = await postPayrollRunToGL(tx, run, userId)
      expect(res.posted).toBe(true)

      const entry = await liveEntry(tx, 'payroll', run.id)
      expect(entry).not.toBeNull()
      if (!entry) return
      expectBalanced(entry.lines)
      // Journal lines are cents.
      expect(debitOn(entry.lines, salaries)).toBe(100000)
      expect(creditOn(entry.lines, netPayable)).toBe(82500)
      expect(creditOn(entry.lines, paye)).toBe(12000)
    })
  })
})

// ── Insurance → GL (receivable / payment / shortfall) ───────────────────────

describe.skipIf(noDb)('admin-v1 §7.x — insurance posts to the books', () => {
  it('receivable: DR 1210 AR-Insurance / CR 2200 patient deposits', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const ar = await accountIdByCode(tx, '1210')
      const dep = await accountIdByCode(tx, '2200')
      const reconId = randomUUID()
      const res = await postInsuranceReceivable(tx, {
        reconciliationId: reconId,
        companyId: randomUUID(),
        patientId: randomUUID(),
        amount: 200,
        date: new Date(),
        createdBy: userId,
      })
      expect(res.posted).toBe(true)
      const entry = await liveEntry(tx, 'insurance_claim', reconId)
      if (!entry) throw new Error('no claim entry')
      expectBalanced(entry.lines)
      expect(debitOn(entry.lines, ar)).toBe(200)
      expect(creditOn(entry.lines, dep)).toBe(200)
    })
  })

  it('full payment clears the receivable to zero (DR bank / CR 1210)', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const ar = await accountIdByCode(tx, '1210')
      const reconId = randomUUID()
      const companyId = randomUUID()
      await postInsuranceReceivable(tx, {
        reconciliationId: reconId,
        companyId,
        patientId: randomUUID(),
        amount: 200,
        date: new Date(),
        createdBy: userId,
      })
      const pay = await postInsurancePayment(tx, {
        reconciliationId: reconId,
        companyId,
        amount: 200,
        date: new Date(),
        createdBy: userId,
      })
      expect(pay.posted).toBe(true)
      // Net 1210 across both entries = DR 200 (claim) - CR 200 (payment) = 0.
      const claim = await liveEntry(tx, 'insurance_claim', reconId)
      const payment = await liveEntry(tx, 'insurance_payment', reconId)
      const net1210 =
        debitOn(claim?.lines ?? [], ar) -
        creditOn(claim?.lines ?? [], ar) +
        debitOn(payment?.lines ?? [], ar) -
        creditOn(payment?.lines ?? [], ar)
      expect(net1210).toBe(0)
    })
  })

  it('partial payment + shortfall write-off together clear the receivable', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const ar = await accountIdByCode(tx, '1210')
      const badDebt = await accountIdByCode(tx, '5900')
      const reconId = randomUUID()
      const companyId = randomUUID()
      await postInsuranceReceivable(tx, {
        reconciliationId: reconId,
        companyId,
        patientId: randomUUID(),
        amount: 200,
        date: new Date(),
        createdBy: userId,
      })
      await postInsurancePayment(tx, {
        reconciliationId: reconId,
        companyId,
        amount: 150,
        date: new Date(),
        createdBy: userId,
      })
      const sf = await postInsuranceShortfall(tx, {
        reconciliationId: reconId,
        companyId,
        amount: 50,
        date: new Date(),
        createdBy: userId,
      })
      expect(sf.posted).toBe(true)
      const short = await liveEntry(tx, 'insurance_shortfall', reconId)
      if (!short) throw new Error('no shortfall entry')
      expect(debitOn(short.lines, badDebt)).toBe(50)
      // 1210 fully cleared: claim DR200, payment CR150, shortfall CR50.
      const claim = await liveEntry(tx, 'insurance_claim', reconId)
      const payment = await liveEntry(tx, 'insurance_payment', reconId)
      const net =
        debitOn(claim?.lines ?? [], ar) -
        creditOn(payment?.lines ?? [], ar) -
        creditOn(short.lines, ar)
      expect(net).toBe(0)
    })
  })

  it('reverseInsuranceGL undoes every insurance entry for the reconciliation', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const reconId = randomUUID()
      const companyId = randomUUID()
      await postInsuranceReceivable(tx, {
        reconciliationId: reconId,
        companyId,
        patientId: randomUUID(),
        amount: 100,
        date: new Date(),
        createdBy: userId,
      })
      await reverseInsuranceGL(tx, reconId, userId)
      // The original claim entry now has a reversal pointing at it.
      const claim = await tx.query.journalEntries.findFirst({
        where: and(
          eq(journalEntries.sourceDocType, 'insurance_claim' as never),
          eq(journalEntries.sourceDocId, reconId),
          eq(journalEntries.isReversal, false)
        ),
      })
      if (!claim) throw new Error('no claim entry')
      const rev = await tx.query.journalEntries.findFirst({
        where: eq(journalEntries.reversesEntryId, claim.id),
      })
      expect(rev).not.toBeNull()
    })
  })
})

// ── Remittance → GL ──────────────────────────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §14.2 — remittance posts DR payable / CR bank', () => {
  it('remits PAYE payable: DR 2330 / CR bank, balanced', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const payeAcct = await getAccountByCode(tx, '2330')
      const bankAcct = await getAccountByCode(tx, '1010')
      if (!payeAcct || !bankAcct) throw new Error('accounts not seeded')
      const remId = randomUUID()
      const outcome = await postInOpenPeriod(
        tx,
        {
          sourceDocType: 'remittance',
          sourceDocId: remId,
          description: 'IT remittance PAYE',
          createdBy: userId,
          lines: [
            { accountId: payeAcct.id, debit: Money.from(300), description: 'Remit PAYE' },
            { accountId: bankAcct.id, credit: Money.from(300), description: 'Paid to govt' },
          ],
        },
        new Date()
      )
      expect(outcome).toBe('posted')
      const entry = await liveEntry(tx, 'remittance', remId)
      if (!entry) throw new Error('no remittance entry')
      expectBalanced(entry.lines)
      expect(debitOn(entry.lines, payeAcct.id)).toBe(300)
      expect(creditOn(entry.lines, bankAcct.id)).toBe(300)
    })
  })
})

// ── Phase 2 — unified catalog integrity ──────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §12.1 (Phase 2) — unified items catalog', () => {
  it('items is the single catalog with the unified provenance + role flags', async () => {
    await withPostingRollback(async (tx) => {
      // The unification dropped products/inventory into one `items` table carrying
      // sellable/consumable/medication/lab flags + a `source` provenance column.
      const [item] = await tx
        .insert(items)
        .values({
          name: `IT Catalog ${randomUUID().slice(0, 8)}`,
          sellable: true,
          consumable: false,
          source: 'product',
        })
        .returning()
      expect(item.id).toBeTruthy()
      expect(item.sellable).toBe(true)
      expect(item.stockQuantity).toBe(0) // defaulted
    })
  })
})
