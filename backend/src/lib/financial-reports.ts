/**
 * financial-reports.ts
 *
 * Phase 1 P&L and Balance Sheet generators. Both are driven entirely by GL
 * queries — no recomputation against the operational tables. Add Cash Flow,
 * AR Aging GL-driven, etc. in later phases by following the same pattern.
 *
 * R1: GL `SUM`s are cast to `::text` and run through `Money` (BigInt-exact)
 * instead of float `SUM` + `.toFixed(2)`. The `ReportRow.amount` fields stay
 * `number` for transport, but every subtraction / accumulation happens in
 * `Money` so the totals never drift (code-report-v1.md M3).
 */

import { Money } from '@denel/utils'
import { eq, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { accounts, journalEntries, journalLines } from '../db/schema'

// The cumulative Balance Sheet has no natural lower bound; this sentinel
// predates any conceivable journal entry.
const LEDGER_EPOCH = '1900-01-01'

export type ReportRow = {
  accountId: string
  accountCode: string
  accountName: string
  amount: number
}

export type ProfitLossReport = {
  from: string
  to: string
  revenue: ReportRow[]
  totalRevenue: number
  expenses: ReportRow[]
  totalExpenses: number
  netIncome: number
}

export type BalanceSheetReport = {
  asOf: string
  assets: ReportRow[]
  totalAssets: number
  liabilities: ReportRow[]
  totalLiabilities: number
  equity: ReportRow[]
  totalEquity: number
  isBalanced: boolean
  imbalance: number
}

/**
 * Profit & Loss for a date range. Revenue = SUM(credit) - SUM(debit) for each
 * revenue account; Expense = SUM(debit) - SUM(credit) for each expense
 * account.
 */
export async function generateProfitLoss(
  db: DB,
  from: string,
  to: string
): Promise<ProfitLossReport> {
  const rows = await accountActivityInRange(db, from, to, ['revenue', 'expense'])

  const revenue: ReportRow[] = []
  const expenses: ReportRow[] = []
  let totalRevenue = Money.zero()
  let totalExpenses = Money.zero()

  for (const r of rows) {
    if (r.type === 'revenue') {
      const amount = r.credit.sub(r.debit)
      revenue.push({
        accountId: r.id,
        accountCode: r.code,
        accountName: r.name,
        amount: amount.toDbValue(),
      })
      totalRevenue = totalRevenue.add(amount)
    } else if (r.type === 'expense') {
      const amount = r.debit.sub(r.credit)
      expenses.push({
        accountId: r.id,
        accountCode: r.code,
        accountName: r.name,
        amount: amount.toDbValue(),
      })
      totalExpenses = totalExpenses.add(amount)
    }
  }

  return {
    from,
    to,
    revenue,
    totalRevenue: totalRevenue.toDbValue(),
    expenses,
    totalExpenses: totalExpenses.toDbValue(),
    netIncome: totalRevenue.sub(totalExpenses).toDbValue(),
  }
}

/**
 * Balance Sheet as of a date. Assets = cumulative DR - CR up to and including
 * the date; Liabilities/Equity = cumulative CR - DR.
 */
export async function generateBalanceSheet(db: DB, asOf: string): Promise<BalanceSheetReport> {
  const rows = await accountActivityInRange(db, LEDGER_EPOCH, asOf, [
    'asset',
    'liability',
    'equity',
  ])

  const assets: ReportRow[] = []
  const liabilities: ReportRow[] = []
  const equity: ReportRow[] = []
  let totalAssets = Money.zero()
  let totalLiabilities = Money.zero()
  let totalEquity = Money.zero()

  for (const r of rows) {
    const amount = r.type === 'asset' ? r.debit.sub(r.credit) : r.credit.sub(r.debit)
    const out: ReportRow = {
      accountId: r.id,
      accountCode: r.code,
      accountName: r.name,
      amount: amount.toDbValue(),
    }
    if (r.type === 'asset') {
      assets.push(out)
      totalAssets = totalAssets.add(amount)
    } else if (r.type === 'liability') {
      liabilities.push(out)
      totalLiabilities = totalLiabilities.add(amount)
    } else if (r.type === 'equity') {
      equity.push(out)
      totalEquity = totalEquity.add(amount)
    }
  }

  const imbalance = totalAssets.sub(totalLiabilities.add(totalEquity))
  return {
    asOf,
    assets,
    totalAssets: totalAssets.toDbValue(),
    liabilities,
    totalLiabilities: totalLiabilities.toDbValue(),
    equity,
    totalEquity: totalEquity.toDbValue(),
    isBalanced: imbalance.abs().lt('0.01'),
    imbalance: imbalance.toDbValue(),
  }
}

// ── internals ────────────────────────────────────────────────────────────────

type ActivityRow = {
  id: string
  code: string
  name: string
  type: string
  debit: Money
  credit: Money
}

async function accountActivityInRange(
  db: DB,
  from: string,
  to: string,
  types: string[]
): Promise<ActivityRow[]> {
  // Aggregate DR/CR per account within [from, to], filtered to the requested
  // account types. We left-join from accounts so accounts with no activity
  // still appear with zero balances. SUMs are cast to text so `Money.fromDb`
  // ingests them exactly (no float round-trip).
  const rows = await db
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      // Date-scope the SUM itself (conditional aggregation). The date predicate
      // must NOT live in the journalEntries JOIN ON: journalLines are joined
      // unconditionally, so an ON-clause filter would leave out-of-range lines in
      // the row set (entry columns NULL) and they'd still be summed — silently
      // turning every range report into an all-time report.
      debit: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntries.entryDate} >= ${from} AND ${journalEntries.entryDate} <= ${to} THEN ${journalLines.debit} ELSE 0 END), 0)::text`,
      credit: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntries.entryDate} >= ${from} AND ${journalEntries.entryDate} <= ${to} THEN ${journalLines.credit} ELSE 0 END), 0)::text`,
    })
    .from(accounts)
    .leftJoin(journalLines, eq(journalLines.accountId, accounts.id))
    .leftJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(inArrayOfTypes(types))
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.type)
    .orderBy(accounts.code)

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    debit: Money.fromDb(r.debit),
    credit: Money.fromDb(r.credit),
  }))
}

function inArrayOfTypes(types: string[]) {
  if (types.length === 1) return eq(accounts.type, types[0])
  // Build OR chain — drizzle's `inArray` works too, but a small OR is
  // perfectly readable for 2–3 element type lists.
  return sql`${accounts.type} IN (${sql.join(
    types.map((t) => sql`${t}`),
    sql`, `
  )})`
}
