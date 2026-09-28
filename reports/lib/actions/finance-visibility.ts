import type { FinanceVisibilityConfig } from '@denel/types'
import { z } from 'zod'
import { api } from '@/lib/api-client'

/**
 * The portal's finance settings page controls which finance modules / charts
 * the reports app surfaces. The config is stored in the backend settings table
 * under `finance_visibility` and exposed read-only at
 * `GET /api/settings/finance-visibility`.
 *
 * If the endpoint is unavailable (older backend), we fall back to "everything
 * visible" — the reports app stays read-only and degrades gracefully rather
 * than hiding reports a user expects to see.
 */
export const DEFAULT_FINANCE_VISIBILITY: FinanceVisibilityConfig = {
  showRevenue: true,
  showExpenses: true,
  showProfit: true,
  showAgingReport: true,
  showTaxCalculations: true,
  showLedgerAdjustments: true,
}

const financeVisibilitySchema = z.object({
  showRevenue: z.boolean(),
  showExpenses: z.boolean(),
  showProfit: z.boolean(),
  showAgingReport: z.boolean(),
  showTaxCalculations: z.boolean(),
  showLedgerAdjustments: z.boolean(),
})

export async function getFinanceVisibility(): Promise<FinanceVisibilityConfig> {
  const res = await api.get<unknown>('/api/settings/finance-visibility')
  if (!res.success || res.data == null) return DEFAULT_FINANCE_VISIBILITY

  const parsed = financeVisibilitySchema.safeParse(res.data)
  if (!parsed.success) return DEFAULT_FINANCE_VISIBILITY
  return parsed.data
}
