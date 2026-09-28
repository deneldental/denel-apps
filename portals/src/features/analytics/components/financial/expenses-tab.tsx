import { Download } from 'lucide-react'
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalyticsData } from '@/lib/actions/analytics'
import type { MonthlyTrendData } from '@/lib/actions/financial-analytics'
import { Button } from '@/shared/components/ui/button'
import { downloadCsv, todayStamp } from '@/shared/utils/csv'
import {
  CUSTOM_TOOLTIP_STYLE,
  EXPENSE_COLORS,
  GHS,
  mergeAnnualExpenses,
  SectionCard,
} from './shared'
import { TaxSummarySection } from './tax-summary-section'

interface Props {
  trend: MonthlyTrendData
  analytics: AnalyticsData
  year: number
}

export function FinancialExpensesTab({ trend, analytics, year }: Props) {
  const categories = mergeAnnualExpenses(analytics)
  const topMonths = [...trend.months].sort((a, b) => b.expenses - a.expenses).slice(0, 5)
  const annualExpenses = trend.totals.expenses

  function exportCsv() {
    const rows: Array<Array<string | number>> = [['Section', 'Label', 'Value', 'Share %']]
    for (const m of trend.months) rows.push(['Monthly expenses', m.month, m.expenses, ''])
    for (const c of categories) rows.push(['By category', c.category, c.amount, c.percentage])
    for (const m of topMonths) {
      const share = annualExpenses > 0 ? Math.round((m.expenses / annualExpenses) * 1000) / 10 : 0
      rows.push(['Top months', m.month, m.expenses, share])
    }
    downloadCsv(
      `financial-expenses-${year}-${todayStamp()}.csv`,
      rows[0] as string[],
      rows.slice(1)
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end print:hidden">
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Monthly expense line */}
      <SectionCard title="Monthly Expenses">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={trend.months} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 10 }}
              width={48}
            />
            <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v) => GHS(v as number)} />
            <Line
              type="monotone"
              dataKey="expenses"
              stroke="#ef4444"
              dot={false}
              strokeWidth={2}
              name="Expenses"
            />
          </LineChart>
        </ResponsiveContainer>
      </SectionCard>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Expenses by category (annual) */}
        <SectionCard title="Expenses by Category">
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No expense data</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={categories}
                    dataKey="amount"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                  >
                    {categories.map((_, i) => (
                      <Cell key={i} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={CUSTOM_TOOLTIP_STYLE}
                    formatter={(v) => GHS(v as number)}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
              <table className="w-full text-xs mt-1">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1">Category</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((cat) => (
                    <tr key={cat.category} className="border-b last:border-0">
                      <td className="py-1 capitalize">{cat.category}</td>
                      <td className="text-right">{GHS(cat.amount)}</td>
                      <td className="text-right">{cat.percentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </SectionCard>

        {/* Top 5 expense months */}
        <SectionCard title="Top 5 Expense Months">
          {topMonths.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No data</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1">Month</th>
                  <th className="text-right">Expenses</th>
                  <th className="text-right">% of Annual</th>
                </tr>
              </thead>
              <tbody>
                {topMonths.map((m) => (
                  <tr key={m.month} className="border-b last:border-0">
                    <td className="py-1.5">{m.month}</td>
                    <td className="text-right">{GHS(m.expenses)}</td>
                    <td className="text-right">
                      {annualExpenses > 0
                        ? Math.round((m.expenses / annualExpenses) * 1000) / 10
                        : 0}
                      %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      {/* Tax (VAT / NHIL / GETFund) collected */}
      <TaxSummarySection year={year} />
    </div>
  )
}
