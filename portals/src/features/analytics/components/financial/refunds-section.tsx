import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getRefundsSummary } from '@/lib/actions/financial-analytics'
import { useApiQuery } from '@/lib/query'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { CUSTOM_TOOLTIP_STYLE, GHS, SectionCard } from './shared'

const REFUNDS_SUMMARY_KEY = (year: number) => ['analytics', 'financial', 'refunds', year] as const

export function RefundsSection({ year }: { year: number }) {
  const query = useApiQuery(REFUNDS_SUMMARY_KEY(year), () => getRefundsSummary(year))
  const data = query.data ?? null
  const loading = query.isLoading

  return (
    <SectionCard title="Refunds">
      {loading ? (
        <Skeleton className="h-[180px] w-full" />
      ) : !data ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No refund data</p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-3">
            <Tile label="Total refunded" value={GHS(data.totals.totalRefunds)} tone="red" />
            <Tile label="Refund count" value={String(data.totals.refundCount)} />
            <Tile label="Refund rate" value={`${data.totals.refundRate}%`} tone="red" />
          </div>
          {data.totals.refundCount > 0 && (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={data.monthly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 10 }}
                  width={42}
                />
                <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v) => GHS(v as number)} />
                <Bar dataKey="amount" fill="#ef4444" radius={[3, 3, 0, 0]} name="Refunds" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </SectionCard>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'red' }) {
  const color = tone === 'red' ? 'text-red-600' : 'text-foreground'
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </p>
      <p className={`text-lg font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  )
}
