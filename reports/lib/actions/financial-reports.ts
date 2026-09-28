import { z } from 'zod'
import { moneySchema as money, parseReport } from '@/lib/actions/report-schema'
import { api } from '@/lib/api-client'

const reportRowSchema = z.object({
  accountId: z.string(),
  accountCode: z.string(),
  accountName: z.string(),
  amount: money,
})

export type ReportRow = z.infer<typeof reportRowSchema>

const profitLossSchema = z.object({
  from: z.string(),
  to: z.string(),
  revenue: z.array(reportRowSchema),
  totalRevenue: money,
  expenses: z.array(reportRowSchema),
  totalExpenses: money,
  netIncome: money,
})

export type ProfitLossReport = z.infer<typeof profitLossSchema>

const balanceSheetSchema = z.object({
  asOf: z.string(),
  assets: z.array(reportRowSchema),
  totalAssets: money,
  liabilities: z.array(reportRowSchema),
  totalLiabilities: money,
  equity: z.array(reportRowSchema),
  totalEquity: money,
  isBalanced: z.boolean(),
  imbalance: money,
})

export type BalanceSheetReport = z.infer<typeof balanceSheetSchema>

export async function getProfitLoss(from: string, to: string) {
  const res = await api.get<unknown>(
    `/api/reports/profit-loss?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  )
  return parseReport(profitLossSchema, res)
}

export async function getBalanceSheet(asOf: string) {
  const res = await api.get<unknown>(`/api/reports/balance-sheet?as_of=${encodeURIComponent(asOf)}`)
  return parseReport(balanceSheetSchema, res)
}
