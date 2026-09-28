import { useSearchParams } from 'react-router-dom'
import { AgingReportSection } from '@/features/analytics/components/aging-report-section'
import {
  FinancialArByPayerTab,
  FinancialCreditTab,
  FinancialDeferredRevenueTab,
} from '@/features/analytics/components/financial/credit-deferred-ar-tab'
import { FinancialExpensesTab } from '@/features/analytics/components/financial/expenses-tab'
import { FinancialOverviewTab } from '@/features/analytics/components/financial/overview-tab'
import { PatientCohortSection } from '@/features/analytics/components/financial/patient-cohort-section'
import { FinancialPaymentPlansTab } from '@/features/analytics/components/financial/payment-plans-tab'
import { FinancialRevenueTab } from '@/features/analytics/components/financial/revenue-tab'
import { LoadingSkeleton } from '@/features/analytics/components/financial/shared'
import { FinancialYearOverYearTab } from '@/features/analytics/components/financial/year-over-year-tab'
import { useAnalyticsPeriod } from '@/features/analytics/period-context'
import { getAnalytics } from '@/lib/actions/analytics'
import {
  getMonthlyTrend,
  getMultiYearComparison,
  getPaymentPlansSummary,
} from '@/lib/actions/financial-analytics'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/shared/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'

const PAYMENT_PLANS_SUMMARY_KEY = ['payment-plans', 'summary'] as const
const MONTHLY_TREND_KEY = (year: number) =>
  ['analytics', 'financial', 'monthly-trend', year] as const
const MULTI_YEAR_KEY = (from: number, to: number) =>
  ['analytics', 'financial', 'multi-year', from, to] as const

type TabId =
  | 'overview'
  | 'revenue'
  | 'expenses'
  | 'aging'
  | 'plans'
  | 'cohorts'
  | 'year-over-year'
  | 'credit'
  | 'deferred'
  | 'ar-payer'
const VALID_TABS: TabId[] = [
  'overview',
  'revenue',
  'expenses',
  'aging',
  'plans',
  'cohorts',
  'year-over-year',
  'credit',
  'deferred',
  'ar-payer',
]

function isTabId(v: string | null): v is TabId {
  return v !== null && (VALID_TABS as string[]).includes(v)
}

/**
 * Financial Analytics — the source page for the clinic's annual financial reports.
 *
 * See memory: project-financial-analytics-role. Every chart here must be backed
 * by authoritative ledger data; future tabs should grow this surface
 * (provider revenue contribution, service profitability, insurance vs OOP, etc.).
 *
 * Period filter wiring: this page's year-bound endpoints (analytics, monthly
 * trend, multi-year) follow the global Analytics period's anchor year. The
 * monthly/quarterly granularity narrows the trend within the year via the
 * backing endpoints' fallback windows.
 *
 * Tabs:
 * - **Overview** — Revenue/Expenses/Profit/Margin hero KPIs + monthly trend + top treatments
 * - **Revenue** — monthly revenue + treatment breakdown + payment methods
 * - **Expenses** — monthly expenses + category breakdown + top expense months
 * - **Aging Report** — A/R aging buckets + per-patient drill-down
 * - **Payment Plans** — 5-status breakdown + collection progress
 * - **Year-over-Year** — multi-year comparison (revenue/expenses/profit + margin trend)
 */
export default function FinancialAnalyticsPage({ printMode = false }: { printMode?: boolean }) {
  const { period } = useAnalyticsPeriod()
  const year = period.anchorYear
  const currentYear = new Date().getFullYear()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = searchParams.get('tab')
  const activeTab: TabId = isTabId(tabParam) ? tabParam : 'overview'

  function setTab(t: TabId) {
    const next = new URLSearchParams(searchParams)
    if (t === 'overview') next.delete('tab')
    else next.set('tab', t)
    setSearchParams(next, { replace: true })
  }

  // ── Data fetching ──────────────────────────────────────────────────────────
  // Year-dependent: analytics (quarterly raw), monthly trend, multi-year comparison
  // Year-independent: payment plans (snapshot of current state)
  const plansQuery = useApiQuery(PAYMENT_PLANS_SUMMARY_KEY, getPaymentPlansSummary)
  const analyticsQuery = useApiQuery(queryKeys.analytics.financial({ year }), () =>
    getAnalytics(year)
  )
  const trendQuery = useApiQuery(MONTHLY_TREND_KEY(year), () => getMonthlyTrend(year))
  const multiYearQuery = useApiQuery(MULTI_YEAR_KEY(year - 4, year), () =>
    getMultiYearComparison(year - 4, year)
  )

  const plansData = plansQuery.data ?? null
  const analyticsData = analyticsQuery.data ?? null
  const trendData = trendQuery.data ?? null
  const multiYearData = multiYearQuery.data ?? null
  const loading = analyticsQuery.isLoading || trendQuery.isLoading || multiYearQuery.isLoading
  const error =
    analyticsQuery.isError || trendQuery.isError || multiYearQuery.isError
      ? 'Some data could not be loaded. Try refreshing.'
      : null

  function renderTabContent(tab: TabId) {
    if (loading && !analyticsData && !trendData) return <LoadingSkeleton />
    if (error && !analyticsData && !trendData) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setTab(activeTab)}>
            Retry
          </Button>
        </div>
      )
    }

    switch (tab) {
      case 'overview':
        if (!trendData || !analyticsData) return <LoadingSkeleton />
        return <FinancialOverviewTab trend={trendData} analytics={analyticsData} year={year} />
      case 'revenue':
        if (!trendData || !analyticsData) return <LoadingSkeleton />
        return <FinancialRevenueTab trend={trendData} analytics={analyticsData} year={year} />
      case 'expenses':
        if (!trendData || !analyticsData) return <LoadingSkeleton />
        return <FinancialExpensesTab trend={trendData} analytics={analyticsData} year={year} />
      case 'aging':
        return <AgingReportSection />
      case 'plans':
        return <FinancialPaymentPlansTab plans={plansData} />
      case 'cohorts':
        return <PatientCohortSection />
      case 'year-over-year':
        if (!multiYearData) return <LoadingSkeleton />
        return <FinancialYearOverYearTab multiYear={multiYearData} currentYear={currentYear} />
      case 'credit':
        return <FinancialCreditTab />
      case 'deferred':
        return <FinancialDeferredRevenueTab />
      case 'ar-payer':
        return <FinancialArByPayerTab />
    }
  }

  if (printMode) {
    return (
      <div className="flex flex-col gap-8 p-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Financial Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Revenue, expenses, A/R aging, payment plans, year-over-year, credit notes, deferred
            revenue and A/R by payer.
          </p>
        </div>
        {VALID_TABS.map((t) => (
          <PrintTabSection key={t} title={TAB_LABEL[t]}>
            {renderTabContent(t)}
          </PrintTabSection>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Financial Analytics</h1>
        <p className="text-muted-foreground mt-1">
          Source page for annual financial reports — revenue, expenses, A/R aging, payment plans and
          year-over-year trends.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabId)} className="w-full">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="aging">Aging Report</TabsTrigger>
          <TabsTrigger value="plans">Payment Plans</TabsTrigger>
          <TabsTrigger value="cohorts">Cohorts</TabsTrigger>
          <TabsTrigger value="year-over-year">Year-over-Year</TabsTrigger>
          <TabsTrigger value="credit">Credit &amp; Write-offs</TabsTrigger>
          <TabsTrigger value="deferred">Deferred Revenue</TabsTrigger>
          <TabsTrigger value="ar-payer">A/R by Payer</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          {renderTabContent('overview')}
        </TabsContent>
        <TabsContent value="revenue" className="mt-4">
          {renderTabContent('revenue')}
        </TabsContent>
        <TabsContent value="expenses" className="mt-4">
          {renderTabContent('expenses')}
        </TabsContent>
        <TabsContent value="aging" className="mt-4">
          {renderTabContent('aging')}
        </TabsContent>
        <TabsContent value="plans" className="mt-4">
          {renderTabContent('plans')}
        </TabsContent>
        <TabsContent value="cohorts" className="mt-4">
          {renderTabContent('cohorts')}
        </TabsContent>
        <TabsContent value="year-over-year" className="mt-4">
          {renderTabContent('year-over-year')}
        </TabsContent>
        <TabsContent value="credit" className="mt-4">
          {renderTabContent('credit')}
        </TabsContent>
        <TabsContent value="deferred" className="mt-4">
          {renderTabContent('deferred')}
        </TabsContent>
        <TabsContent value="ar-payer" className="mt-4">
          {renderTabContent('ar-payer')}
        </TabsContent>
      </Tabs>
    </div>
  )
}

const TAB_LABEL: Record<TabId, string> = {
  overview: 'Overview',
  revenue: 'Revenue',
  expenses: 'Expenses',
  aging: 'Aging Report',
  plans: 'Payment Plans',
  cohorts: 'Cohorts',
  'year-over-year': 'Year-over-Year',
  credit: 'Credit & Write-offs',
  deferred: 'Deferred Revenue',
  'ar-payer': 'A/R by Payer',
}

function PrintTabSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold border-b pb-1">{title}</h2>
      {children}
    </section>
  )
}
