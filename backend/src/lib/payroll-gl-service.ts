/**
 * payroll-gl-service.ts — admin-v1 Phase 4 (§14.1).
 *
 * On publishing a payroll run, post it to the books:
 *   DR 5100 Salaries Expense        (total gross)
 *   DR 5120 SSNIT Employer Expense  (employer 13%)
 *   CR 2330 PAYE Payable            (income tax withheld)
 *   CR 2340 SSNIT Payable           (employee 5.5% + employer 13%)
 *   CR 1230 Staff Loan Receivable   (loan installments deducted from take-home)
 *   CR 2350 Net Salaries Payable    (net pay accrued; cleared at disbursement)
 *
 * Totals are summed from the PAYSLIPS (the computed source of truth) with the Money
 * class so the entry is cent-exact. Idempotent on ('payroll', run.id).
 *
 * HR-H9: publish ACCRUES net pay to Net Salaries Payable (a liability) — it does NOT
 * credit Bank. The separate disbursement step (POST /runs/:id/pay) later posts
 * DR 2350 / CR 1010 Bank, so the bank only moves when cash actually leaves and a
 * never-disbursed run is distinguishable from a paid one.
 *
 * HR-C1: net pay is reduced by loan installments but gross/salaries is NOT, so the
 * balance identity is `gross == paye + ssnit_ee + net + loan`. The loan leg credits
 * Staff Loan Receivable (a reclassification of cash: take-home that settles the
 * employee's loan instead of leaving the bank), keeping the entry balanced WITH
 * loans present. Without it the run was unbalanced by exactly the loan total and
 * the WHOLE run silently failed to post.
 */

import { Money } from '@denel/utils'
import { eq } from 'drizzle-orm'
import type { DB } from '../db'
import { type payrollRuns, payslips } from '../db/schema'
import { getAccountByCode } from './channel-accounts'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import { postInOpenPeriod } from './gl-service'

type RunRow = typeof payrollRuns.$inferSelect

export type PayrollReason = 'no_payslips' | 'no_account' | 'closed_period' | 'unbalanced'
export interface PayrollResult {
  posted: boolean
  reason?: PayrollReason
  // HR-H2: surfaced so the publish response can warn that a closed-period run was
  // re-dated into the current open period (a prior-period adjustment).
  redated?: boolean
  postedDate?: string | null
}

export async function postPayrollRunToGL(
  db: DB,
  run: RunRow,
  createdBy: string
): Promise<PayrollResult> {
  const rows = await db
    .select({
      gross: payslips.grossPay,
      net: payslips.netPay,
      deductions: payslips.deductions,
    })
    .from(payslips)
    .where(eq(payslips.payrollRunId, run.id))
  if (rows.length === 0) return { posted: false, reason: 'no_payslips' }

  let gross = Money.zero()
  let net = Money.zero()
  let paye = Money.zero()
  let ssnitEe = Money.zero()
  let ssnitEr = Money.zero()
  let overtimeTax = Money.zero()
  let loan = Money.zero()
  for (const r of rows) {
    gross = gross.add(Money.fromDb(r.gross))
    net = net.add(Money.fromDb(r.net))
    const d = (r.deductions ?? {}) as {
      paye?: number
      overtime_tax?: number
      ssnit_employee?: number
      ssnit_employer?: number
      loan?: number
    }
    // `grossPay`/`netPay` above are integer CENT columns, but the `deductions`
    // JSONB is written in CEDIS (payroll.ts builds it with `Money.toNumber()`;
    // migration 0209 converted columns, not JSONB). Reading these legs with
    // `fromDb` treated cedis as cents, so every leg came out 100× too small and
    // `gross == paye + ssnit_ee + net + loan` could never hold: the run failed
    // the balance check and silently did not post. `/runs/:id/ledger` does the
    // same normalisation for the same reason.
    paye = paye.add(Money.fromNumber(d.paye ?? 0))
    overtimeTax = overtimeTax.add(Money.fromNumber(d.overtime_tax ?? 0))
    ssnitEe = ssnitEe.add(Money.fromNumber(d.ssnit_employee ?? 0))
    ssnitEr = ssnitEr.add(Money.fromNumber(d.ssnit_employer ?? 0))
    loan = loan.add(Money.fromNumber(d.loan ?? 0))
  }

  const [salaries, payePayable, ssnitPayable, ssnitErExp, netSalariesPayable, loanReceivable] =
    await Promise.all([
      getAccountByCode(db, FINANCE_ACCOUNTS.SALARIES_EXPENSE),
      getAccountByCode(db, FINANCE_ACCOUNTS.PAYE_PAYABLE),
      getAccountByCode(db, FINANCE_ACCOUNTS.SSNIT_PAYABLE),
      getAccountByCode(db, FINANCE_ACCOUNTS.SSNIT_EMPLOYER_EXPENSE),
      getAccountByCode(db, FINANCE_ACCOUNTS.NET_SALARIES_PAYABLE),
      getAccountByCode(db, FINANCE_ACCOUNTS.STAFF_LOAN_RECEIVABLE),
    ])
  // loanReceivable is only required when there ARE loan deductions in this run.
  if (!salaries || !payePayable || !ssnitPayable || !ssnitErExp || !netSalariesPayable) {
    return { posted: false, reason: 'no_account' }
  }
  if (loan.isPositive() && !loanReceivable) {
    return { posted: false, reason: 'no_account' }
  }

  const ssnitTotal = ssnitEe.add(ssnitEr)
  const taxPayable = paye.add(overtimeTax)
  const lines: Array<{
    accountId: string
    debit?: Money
    credit?: Money
    description: string
  }> = []
  if (gross.isPositive())
    lines.push({ accountId: salaries.id, debit: gross, description: 'Salaries' })
  if (ssnitEr.isPositive())
    lines.push({ accountId: ssnitErExp.id, debit: ssnitEr, description: 'SSNIT (employer)' })
  if (taxPayable.isPositive())
    lines.push({ accountId: payePayable.id, credit: taxPayable, description: 'PAYE withheld' })
  if (ssnitTotal.isPositive())
    lines.push({ accountId: ssnitPayable.id, credit: ssnitTotal, description: 'SSNIT payable' })
  // HR-C1: loan installments settle the Staff Loan Receivable asset rather than
  // leaving the bank — this credit balances the gross DR against the reduced net.
  if (loan.isPositive() && loanReceivable)
    lines.push({ accountId: loanReceivable.id, credit: loan, description: 'Staff loan repayment' })
  // HR-H9: net pay accrues to the Net Salaries Payable liability (not Bank).
  if (net.isPositive())
    lines.push({
      accountId: netSalariesPayable.id,
      credit: net,
      description: 'Net pay (payable)',
    })
  if (lines.length < 2) return { posted: false, reason: 'no_payslips' }

  // Never silently drop: a closed pay-period month falls back to the current open
  // period (a standard prior-period adjustment). HR-H2: capture whether that
  // happened so the publish response can surface it instead of staying silent,
  // and stamp the intended pay period in the memo so the original period is always
  // recoverable from the entry.
  const periodStart = (run.payPeriodStart ?? new Date()).toISOString().slice(0, 10)
  const periodEnd = (run.payPeriodEnd ?? new Date()).toISOString().slice(0, 10)
  const detail = { redated: false, postedDate: null as Date | null }
  try {
    const outcome = await postInOpenPeriod(
      db,
      {
        sourceDocType: 'payroll',
        sourceDocId: run.id,
        description: `Payroll: ${run.name} (pay period ${periodStart}..${periodEnd})`,
        createdBy,
        lines,
      },
      run.payPeriodEnd ?? new Date(),
      detail
    )
    return outcome === 'posted'
      ? {
          posted: true,
          redated: detail.redated,
          postedDate: detail.postedDate ? detail.postedDate.toISOString().slice(0, 10) : null,
        }
      : { posted: false, reason: 'closed_period' }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).toLowerCase()
    if (msg.includes('balance') || msg.includes('debit') || msg.includes('credit')) {
      return { posted: false, reason: 'unbalanced' }
    }
    throw e
  }
}
