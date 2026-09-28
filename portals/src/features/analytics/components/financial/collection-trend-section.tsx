import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getCollectionTrend } from '@/lib/actions/financial-analytics'
import { useApiQuery } from '@/lib/query'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { CUSTOM_TOOLTIP_STYLE, GHS, SectionCard } from './shared'

const COLLECTION_TREND_KEY = (year: number) =>
  ['analytics', 'financial', 'collection-trend', year] as const

/**
 * Collection Rate Trend — monthly view of how much of what was invoiced got
 * collected. Headline analytic for "are we actually getting paid?".
 */
export function CollectionTrendSection({ year }: { year: number }) {
  const query = useApiQuery(COLLECTION_TREND_KEY(year), () => getCollectionTrend(year))
  const data = query.data ?? null
  const loading = query.isLoading

  return (
    <SectionCard title="Collection Rate — Monthly">
      {loading ? (
        <Skeleton className="h-[260px] w-full" />
      ) : !data ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No collection data</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-6 text-xs">
            <div>
              <span className="text-muted-foreground">Invoiced</span>
              <span className="ml-2 font-semibold">{GHS(data.totals.totalInvoiced)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Received</span>
              <span className="ml-2 font-semibold text-emerald-600">
                {GHS(data.totals.totalReceived)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Avg collection rate</span>
              <span className="ml-2 font-semibold">{data.totals.avgCollectionRate}%</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.months} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis
                yAxisId="left"
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 10 }}
                width={52}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 10 }}
                width={42}
                domain={[0, 100]}
              />
              <Tooltip
                contentStyle={CUSTOM_TOOLTIP_STYLE}
                formatter={(v, name) => {
                  if (name === 'Collection rate') return [`${v}%`, name]
                  return [GHS(v as number), name as string]
                }}
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="invoiced"
                stroke="#2563eb"
                dot={false}
                strokeWidth={2}
                name="Invoiced"
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="received"
                stroke="#16a34a"
                dot={false}
                strokeWidth={2}
                name="Received"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="collection_rate"
                stroke="#a855f7"
                dot={false}
                strokeWidth={2}
                strokeDasharray="4 2"
                name="Collection rate"
              />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </SectionCard>
  )
}
