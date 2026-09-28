import { z } from 'zod'
import {
  countSchema as count,
  moneySchema as money,
  parseReport,
} from '@/lib/actions/report-schema'
import { api } from '@/lib/api-client'

// ── Cash flow ───────────────────────────────────────────────────────────────

const cashFlowLineSchema = z.object({
  sourceDocType: z.string(),
  net: money,
})

const cashFlowSchema = z.object({
  from: z.string(),
  to: z.string(),
  operating: z.array(cashFlowLineSchema),
  investing: z.array(cashFlowLineSchema),
  financing: z.array(cashFlowLineSchema),
  totals: z.object({ operating: money, investing: money, financing: money }),
  netChange: money,
  openingCash: money,
  closingCash: money,
})

export type CashFlowReport = z.infer<typeof cashFlowSchema>

export async function getCashFlow(from: string, to: string) {
  const res = await api.get<unknown>(
    `/api/reports/cash-flow?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  )
  return parseReport(cashFlowSchema, res)
}

// ── Revenue by category ─────────────────────────────────────────────────────

const revenueByCategorySchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(
    z.object({
      accountCode: z.string(),
      accountName: z.string(),
      subtype: z.string().nullable(),
      amount: money,
    })
  ),
  total: money,
})

export type RevenueByCategoryReport = z.infer<typeof revenueByCategorySchema>

export async function getRevenueByCategory(from: string, to: string) {
  const res = await api.get<unknown>(
    `/api/reports/revenue-by-category?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  )
  return parseReport(revenueByCategorySchema, res)
}

// ── Revenue by provider/specialist ──────────────────────────────────────────

const revenueByProviderSchema = z.object({
  from: z.string(),
  to: z.string(),
  by: z.enum(['provider', 'specialist']),
  rows: z.array(
    z.object({
      id: z.string().nullable(),
      name: z.string(),
      revenue: money,
      lineCount: count,
    })
  ),
  total: money,
})

export type RevenueByProviderReport = z.infer<typeof revenueByProviderSchema>

export async function getRevenueByProvider(
  from: string,
  to: string,
  by: 'provider' | 'specialist' = 'provider'
) {
  const params = new URLSearchParams({ from, to, by })
  const res = await api.get<unknown>(`/api/reports/revenue-by-provider?${params}`)
  return parseReport(revenueByProviderSchema, res)
}

// ── Cash position ───────────────────────────────────────────────────────────

const cashPositionSchema = z.object({
  from: z.string(),
  to: z.string(),
  accounts: z.array(
    z.object({
      accountCode: z.string(),
      accountName: z.string(),
      opening: money,
      inflow: money,
      outflow: money,
      closing: money,
    })
  ),
  totals: z.object({ opening: money, inflow: money, outflow: money, closing: money }),
})

export type CashPositionReport = z.infer<typeof cashPositionSchema>

export async function getCashPosition(from: string, to: string) {
  const res = await api.get<unknown>(
    `/api/reports/cash-position?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  )
  return parseReport(cashPositionSchema, res)
}
