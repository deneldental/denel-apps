import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getTaxSummary } from '@/lib/actions/financial-analytics'
import { useApiQuery } from '@/lib/query'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { CUSTOM_TOOLTIP_STYLE, GHS, SectionCard } from './shared'

const TAX_SUMMARY_KEY = (year: number) => ['analytics', 'financial', 'tax-summary', year] as const

/**
 * Tax summary — VAT / NHIL / GETFund collected for the year, derived from
 * `taxCalculations` snapshots. These are the levies the clinic must remit to
 * the Ghana Revenue Authority — a required line on annual reports.
 */
export function TaxSummarySection({ year }: { year: number }) {
  const query = useApiQuery(TAX_SUMMARY_KEY(year), () => getTaxSummary(year))
  const data = query.data ?? null
  const loading = query.isLoading

  if (loading) {
    return (
      <SectionCard title="Tax Collected (VAT / NHIL / GETFund)">
        <Skeleton className="h-[200px] w-full" />
      </SectionCard>
    )
  }
  if (!data || data.totals.calcCount === 0) {
    return (
      <SectionCard title="Tax Collected (VAT / NHIL / GETFund)">
        <p className="py-4 text-center text-xs text-muted-foreground">
          No tax calculations recorded this year.
        </p>
      </SectionCard>
    )
  }

  return (
    <SectionCard title="Tax Collected (VAT / NHIL / GETFund)">
      <div className="mb-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="VAT" value={GHS(data.totals.vat)} color="text-blue-600" />
        <Tile label="NHIL" value={GHS(data.totals.nhil)} color="text-emerald-600" />
        <Tile label="GETFund" value={GHS(data.totals.getfund)} color="text-purple-600" />
        <Tile label="Total tax" value={GHS(data.totals.totalTax)} color="text-foreground" />
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Base: {GHS(data.totals.baseAmount)} · Gross: {GHS(data.totals.grossTotal)} ·{' '}
        {data.totals.calcCount} calculations
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data.monthly} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            tick={{ fontSize: 10 }}
            width={48}
          />
          <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v) => GHS(v as number)} />
          <Legend />
          <Bar dataKey="vat" stackId="a" fill="#2563eb" name="VAT" />
          <Bar dataKey="nhil" stackId="a" fill="#16a34a" name="NHIL" />
          <Bar dataKey="getfund" stackId="a" fill="#a855f7" name="GETFund" />
        </BarChart>
      </ResponsiveContainer>
    </SectionCard>
  )
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </p>
      <p className={`text-lg font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  )
}
