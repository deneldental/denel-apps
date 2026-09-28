import { api } from '@/lib/api-client'

export interface MonthlyTrendMonth {
  month: string
  income: number
  expenses: number
  profit: number
  profit_margin: number
}

export interface MonthlyTrendTotals {
  income: number
  expenses: number
  profit: number
  profit_margin: number
}

export interface MonthlyTrendData {
  year: number
  months: MonthlyTrendMonth[]
  totals: MonthlyTrendTotals
}

export interface MultiYearEntry {
  year: number
  revenue: number
  expenses: number
  net_profit: number
}

export interface MultiYearData {
  from: number
  to: number
  years: MultiYearEntry[]
}

export interface PaymentPlanStatusEntry {
  status: string
  count: number
  total_amount: number
}

export interface PaymentPlansSummaryTotals {
  total_plans: number
  active_amount: number
  overdue_amount: number
  outstanding_amount: number
  completed_amount: number
}

export interface PaymentPlansSummaryData {
  summary: PaymentPlanStatusEntry[]
  totals: PaymentPlansSummaryTotals
}

export async function getMonthlyTrend(year: number) {
  return api.get<MonthlyTrendData>(`/api/financial-analytics/monthly-trend?year=${year}`)
}

export async function getMultiYearComparison(from: number, to: number) {
  return api.get<MultiYearData>(`/api/financial-analytics/multi-year?from=${from}&to=${to}`)
}

export async function getPaymentPlansSummary() {
  return api.get<PaymentPlansSummaryData>(`/api/financial-analytics/payment-plans-summary`)
}

// ── /collection-trend ────────────────────────────────────────────────────────

export interface CollectionTrendMonth {
  month: string
  invoiced: number
  received: number
  collection_rate: number
}

export interface CollectionTrendData {
  year: number
  months: CollectionTrendMonth[]
  totals: { totalInvoiced: number; totalReceived: number; avgCollectionRate: number }
}

export async function getCollectionTrend(year: number) {
  return api.get<CollectionTrendData>(`/api/financial-analytics/collection-trend?year=${year}`)
}

// ── /refunds-summary ─────────────────────────────────────────────────────────

export interface RefundsMonth {
  month: string
  amount: number
  count: number
}

export interface RefundsSummaryData {
  year: number
  totals: {
    totalRefunds: number
    refundCount: number
    refundRate: number
    totalRevenue: number
  }
  monthly: RefundsMonth[]
}

export async function getRefundsSummary(year: number) {
  return api.get<RefundsSummaryData>(`/api/financial-analytics/refunds-summary?year=${year}`)
}

// ── /payment-method-split ────────────────────────────────────────────────────

export interface PaymentMethodEntry {
  method: string
  count: number
  amount: number
  percentage: number
}

export interface InsuranceVsOop {
  insurance: { amount: number; count: number; percentage: number }
  out_of_pocket: { amount: number; count: number; percentage: number }
}

export interface PaymentMethodSplitData {
  year: number
  byMethod: PaymentMethodEntry[]
  insuranceVsOop: InsuranceVsOop
  totals: { amount: number; count: number }
}

export async function getPaymentMethodSplit(year: number) {
  return api.get<PaymentMethodSplitData>(
    `/api/financial-analytics/payment-method-split?year=${year}`
  )
}

// ── /top-patients ────────────────────────────────────────────────────────────

export interface TopPatientEntry {
  patient_id: string
  name: string
  patient_code: string | null
  revenue: number
  payment_count: number
}

export async function getTopPatients(year: number, limit = 10) {
  return api.get<TopPatientEntry[]>(
    `/api/financial-analytics/top-patients?year=${year}&limit=${limit}`
  )
}

// ── /provider-revenue ────────────────────────────────────────────────────────

export interface ProviderRevenueEntry {
  provider_id: string
  name: string
  provider_type: 'doctor' | 'specialist'
  revenue: number
  line_count: number
  percentage: number
}

export interface ProviderRevenueData {
  year: number
  providers: ProviderRevenueEntry[]
  totals: { revenue: number; providerCount: number }
}

export async function getProviderRevenue(year: number) {
  return api.get<ProviderRevenueData>(`/api/financial-analytics/provider-revenue?year=${year}`)
}

// ── /tax-summary ─────────────────────────────────────────────────────────────

export interface TaxMonth {
  month: string
  vat: number
  nhil: number
  getfund: number
  total: number
}

export interface TaxSummaryData {
  year: number
  totals: {
    baseAmount: number
    vat: number
    nhil: number
    getfund: number
    totalTax: number
    grossTotal: number
    calcCount: number
  }
  monthly: TaxMonth[]
}

export async function getTaxSummary(year: number) {
  return api.get<TaxSummaryData>(`/api/financial-analytics/tax-summary?year=${year}`)
}

// ── Patient cohorts ──────────────────────────────────────────────────────────

export interface CohortCell {
  revenue: number
  activePatients: number
}

export interface CohortRow {
  /** YYYY-MM. */
  month: string
  /** Patients whose first completed payment fell in this month. */
  cohortSize: number
  /** Length-12 array: index N is revenue from this cohort N months after first payment. */
  cells: CohortCell[]
}

export interface PatientCohortsData {
  generatedAt: string
  /** Rows ordered oldest → newest, exactly 12 entries. */
  cohorts: CohortRow[]
  /** Highest cell.revenue across the matrix — frontend uses for colour scaling. */
  maxRevenue: number
}

export async function getPatientCohorts() {
  return api.get<PatientCohortsData>('/api/financial-analytics/patient-cohorts')
}

// ── Credit notes / write-offs / refunds ──────────────────────────────────────

export interface CreditSummaryData {
  generatedAt: string
  tiles: {
    totalPostedAmount: number
    totalPostedCount: number
    writeOffAmount: number
    writeOffRatioPct: number
    totalRevenue: number
  }
  byReason: Array<{
    reason: string
    amount: number
    count: number
    postedAmount: number
    postedCount: number
  }>
  monthly: Array<{
    month: string
    writeoff: number
    refund: number
    other: number
    total: number
  }>
}

export async function getCreditSummary(periodQuery = '') {
  return api.get<CreditSummaryData>(`/api/financial-analytics/credit-summary${periodQuery}`)
}

// ── Deferred revenue waterfall ───────────────────────────────────────────────

export interface DeferredRevenueData {
  generatedAt: string
  tiles: {
    totalDeferred: number
    totalRecognized: number
    stillDeferred: number
    deferredLineCount: number
    recognitionEvents: number
  }
  waterfall: Array<{ stage: string; amount: number }>
  byTrigger: Array<{ trigger: string; amount: number; count: number }>
  monthly: Array<{ month: string; amount: number }>
}

export async function getDeferredRevenue(periodQuery = '') {
  return api.get<DeferredRevenueData>(`/api/financial-analytics/deferred-revenue${periodQuery}`)
}

// ── A/R by payer ─────────────────────────────────────────────────────────────

export interface ArByPayerData {
  generatedAt: string
  tiles: {
    totalAR: number
    insuredAR: number
    selfPayAR: number
    insuredSharePct: number
    payerCount: number
  }
  byPayer: Array<{ payer: string; balance: number; patientCount: number }>
}

export async function getArByPayer() {
  return api.get<ArByPayerData>('/api/financial-analytics/ar-by-payer')
}
