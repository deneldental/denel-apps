import { api } from '@/lib/api-client'

export async function getDailyReports() {
  const res = await api.get<any[]>('/api/reports')
  return { success: res.success, data: res.data || [], error: res.error }
}

export async function createDailyReport(data: any) {
  const res = await api.post<any>('/api/reports', data)
  return res
}

export async function getDailyReportById(id: string) {
  const res = await api.get<any>(`/api/reports/${id}`)
  return { success: res.success, data: res.data, error: res.error }
}

export async function deleteDailyReport(id: string) {
  const res = await api.delete<any>(`/api/reports/${id}`)
  return res
}

// ── Report-day waivers ────────────────────────────────────────────────────────
// Admin-only: excuse a specific day from the missed-reports banner without
// submitting a fabricated report for it.

export interface ReportDayWaiver {
  date: string
  reason: string | null
  waivedById: string | null
  waivedByName: string | null
  createdAt: string
}

export async function getReportDayWaivers() {
  const res = await api.get<ReportDayWaiver[]>('/api/reports/waivers')
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function waiveReportDay(date: string, reason?: string | null) {
  const res = await api.post<ReportDayWaiver>('/api/reports/waivers', { date, reason })
  return res
}

export async function unwaiveReportDay(date: string) {
  const res = await api.delete<void>(`/api/reports/waivers/${date}`)
  return res
}

// ── Restock drafts ────────────────────────────────────────────────────────────

export interface RestockDraft {
  id: string
  date: string
  inventoryId: string | null
  inventoryType: 'inventory' | 'product' | string
  name: string
  quantityAdded: number
  location: string | null
  recordedById: string | null
  recordedAt: string
}

export async function getRestockDrafts(date?: string) {
  const query = date ? `?date=${encodeURIComponent(date)}` : ''
  const res = await api.get<RestockDraft[]>(`/api/reports/restock-drafts${query}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function addRestockDraft(data: {
  date?: string
  inventoryId: string | null
  inventoryType?: 'inventory' | 'product'
  name: string
  quantityAdded: number
  location?: string | null
}) {
  const res = await api.post<RestockDraft>('/api/reports/restock-drafts', data)
  return res
}

export async function removeRestockDraft(id: string) {
  const res = await api.delete<void>(`/api/reports/restock-drafts/${id}`)
  return res
}

// ── §10.3 Period rollup ─────────────────────────────────────────────────────────
// Aggregates the frozen per-module digest blocks (§10.1) across every daily report
// in [from, to] into one period-level summary, plus the GL-reconciled period
// revenue/expense (§10.2). Backend: GET /api/reports/period-rollup.

export interface PeriodModuleMetric {
  label: string
  value: string | number
  /** False when the metric wasn't numeric and was carried through, not summed. */
  aggregated: boolean
}

export interface PeriodModuleSummary {
  module: string
  title: string
  metrics: PeriodModuleMetric[]
}

export interface PeriodRollup {
  from: string
  to: string
  /** Number of daily reports that contributed to this rollup. */
  dayCount: number
  modules: PeriodModuleSummary[]
  glReconciled: { revenue: number; expenses: number; netIncome: number }
}

export async function getPeriodRollup(from: string, to: string) {
  const res = await api.get<PeriodRollup>(
    `/api/reports/period-rollup?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  )
  return { success: res.success, data: res.data, error: res.error }
}

export interface DailyExpenseTotal {
  totalExpenses: number
  expenseCount: number
}

/**
 * The day's expense TOTAL for the daily-report reconciliation panel.
 *
 * Reception submits the report but has no `expenses:read`, so `/api/expenses`
 * 403s for them and a local sum would collapse to zero. This aggregate is gated
 * on `reports:create` instead, and returns no individual expense rows.
 */
export async function getDailyExpenseTotal(date: string) {
  const res = await api.get<DailyExpenseTotal>(
    `/api/reports/daily-expense-total?date=${encodeURIComponent(date)}`
  )
  return { success: res.success, data: res.data, error: res.error }
}

// ── Price adjustments (0215) — admin-only surcharge/discount monitoring ──────

export interface PriceAdjustmentRow {
  lineId: string
  invoiceId: string
  invoiceNumber: string
  issueDate: string | null
  patientId: string | null
  patientName: string | null
  description: string
  lineSubtotal: number
  type: string
  value: number
  amount: number
  deltaPct: number | null
  byId: string | null
  byName: string | null
  providerId: string | null
  providerName: string | null
}

export interface PriceAdjustmentsReport {
  from: string
  to: string
  surcharges: PriceAdjustmentRow[]
  discounts: PriceAdjustmentRow[]
  totals: { surcharges: number; discounts: number }
}

export async function getPriceAdjustmentsReport(from: string, to: string) {
  const res = await api.get<PriceAdjustmentsReport>(
    `/api/reports/price-adjustments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  )
  return { success: res.success, data: res.data, error: res.error }
}
