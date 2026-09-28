import { Download } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalyticsData } from '@/lib/actions/analytics'
import type { MonthlyTrendData } from '@/lib/actions/financial-analytics'
import { Button } from '@/shared/components/ui/button'
import { downloadCsv, todayStamp } from '@/shared/utils/csv'
import { InsuranceVsOopSection } from './insurance-vs-oop-section'
import { ProviderRevenueSection } from './provider-revenue-section'
import { RefundsSection } from './refunds-section'
import {
  CUSTOM_TOOLTIP_STYLE,
  GHS,
  mergeAnnualTreatments,
  SectionCard,
  TREATMENT_COLORS,
} from './shared'
import { TopPatientsSection } from './top-patients-section'

interface Props {
  trend: MonthlyTrendData
  analytics: AnalyticsData
  year: number
}

export function FinancialRevenueTab({ trend, analytics, year }: Props) {
  const treatments = mergeAnnualTreatments(analytics).slice(0, 10)

  function exportCsv() {
    const rows: Array<Array<string | number>> = []
    rows.push(['Section', 'Label', 'Value'])
    for (const m of trend.months) rows.push(['Monthly revenue', m.month, m.income])
    for (const t of treatments) rows.push(['Top treatments', t.name, t.amount])
    downloadCsv(`financial-revenue-${year}-${todayStamp()}.csv`, rows[0] as string[], rows.slice(1))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end print:hidden">
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Monthly revenue bars */}
      <SectionCard title="Monthly Revenue">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={trend.months} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 10 }}
              width={48}
            />
            <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v) => GHS(v as number)} />
            <Bar dataKey="income" fill="#2563eb" radius={[4, 4, 0, 0]} name="Revenue" />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* Revenue by treatment (top 10) */}
      <SectionCard title="Revenue by Treatment (Top 10)">
        {treatments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No treatment data</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, treatments.length * 32)}>
            <BarChart
              data={treatments}
              layout="vertical"
              margin={{ top: 0, right: 8, left: 8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis
                type="number"
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 10 }}
              />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
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

      {/* Insurance vs Out-of-Pocket + per-method breakdown */}
      <InsuranceVsOopSection year={year} />

      {/* Top patients by revenue */}
      <TopPatientsSection year={year} limit={10} />

      {/* Revenue attributed by provider */}
      <ProviderRevenueSection year={year} />

      {/* Refunds */}
      <RefundsSection year={year} />
    </div>
  )
}
