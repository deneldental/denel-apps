import { Activity, ArrowDownCircle, DollarSign, Download, Percent } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalyticsData } from '@/lib/actions/analytics'
import type { MonthlyTrendData } from '@/lib/actions/financial-analytics'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { downloadCsv, todayStamp } from '@/shared/utils/csv'
import { CollectionTrendSection } from './collection-trend-section'
import {
  CUSTOM_TOOLTIP_STYLE,
  GHS,
  mergeAnnualTreatments,
  SectionCard,
  TREATMENT_COLORS,
} from './shared'

interface Props {
  trend: MonthlyTrendData
  analytics: AnalyticsData
  year: number
}

/**
 * Overview — top-of-page summary of financial performance for the selected year.
 *
 * Hero KPIs (Revenue / Expenses / Profit / Margin) are derived from `monthly-trend`
 * totals. They mirror the universal P&L summary used in annual reports — the
 * single most-referenced view per [[project-financial-analytics-role]].
 */
export function FinancialOverviewTab({ trend, analytics, year }: Props) {
  const { totals, months } = trend
  const treatments = mergeAnnualTreatments(analytics).slice(0, 5)

  function exportCsv() {
    downloadCsv(
      `financial-overview-${year}-${todayStamp()}.csv`,
      ['Month', 'Revenue', 'Expenses', 'Profit', 'Profit Margin %'],
      [
        ...months.map((m) => [m.month, m.income, m.expenses, m.profit, m.profit_margin]),
        ['TOTAL', totals.income, totals.expenses, totals.profit, totals.profit_margin],
      ]
    )
  }

  const kpis = [
    {
      label: 'Total Revenue',
      value: totals.income,
      icon: DollarSign,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Total Expenses',
      value: totals.expenses,
      icon: ArrowDownCircle,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      label: 'Net Profit',
      value: totals.profit,
      icon: Activity,
      color: totals.profit >= 0 ? 'text-blue-600' : 'text-red-600',
      bg: totals.profit >= 0 ? 'bg-blue-50' : 'bg-red-50',
    },
    {
      label: 'Profit Margin',
      value: null as number | null,
      icon: Percent,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
      pct: totals.profit_margin,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end print:hidden">
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Hero KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-4 pb-4">
              <div
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${k.bg} mb-2`}
              >
                <k.icon className={`h-4 w-4 ${k.color}`} />
              </div>
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className={`text-lg font-bold mt-0.5 ${k.color}`}>
                {k.value !== null ? GHS(k.value) : `${k.pct}%`}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Monthly trend — revenue vs expenses vs profit */}
      <SectionCard title="Monthly Trend — Revenue vs Expenses vs Profit">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={months} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis
              tickFormatter={(v) => `GHS ${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 10 }}
              width={64}
            />
            <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v) => GHS(v as number)} />
            <Legend />
            <Line
              type="monotone"
              dataKey="income"
              stroke="#2563eb"
              dot={false}
              strokeWidth={2}
              name="Revenue"
            />
            <Line
              type="monotone"
              dataKey="expenses"
              stroke="#ef4444"
              dot={false}
              strokeWidth={2}
              name="Expenses"
            />
            <Line
              type="monotone"
              dataKey="profit"
              stroke="#16a34a"
              dot={false}
              strokeWidth={2}
              name="Profit"
              strokeDasharray="4 2"
            />
          </LineChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* Collection rate trend — how much of what was invoiced got collected */}
      <CollectionTrendSection year={year} />

      {/* Top 5 revenue treatments (annual) */}
      <SectionCard title="Top 5 Revenue Treatments (Annual)">
        {treatments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No treatment data</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={treatments}
              layout="vertical"
              margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 10 }}
              />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
              <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v) => GHS(v as number)} />
              <Bar dataKey="amount" radius={[0, 4, 4, 0]} name="Revenue">
                {treatments.map((_, i) => (
                  <Cell key={i} fill={TREATMENT_COLORS[i % TREATMENT_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </SectionCard>
    </div>
  )
}
