import {
  AlertTriangle,
  Banknote,
  CalendarCheck,
  CalendarX,
  Coins,
  Minus,
  Package,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { type ComponentType, useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAnalyticsPeriod } from '@/features/analytics/period-context'
import {
  buildPeriodQuery,
  type ExecutiveOverview,
  getExecutiveOverview,
} from '@/lib/actions/analytics'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { formatAmount } from '@/shared/utils/currency'

const GHS = (n: number) => `GHS ${formatAmount(n)}`

const GHS_COMPACT = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `GHS ${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `GHS ${(n / 1_000).toFixed(1)}K`
  return GHS(n)
}

const SHORT_DAY = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ── KPI tile ──────────────────────────────────────────────────────────────────

interface KpiTileProps {
  label: string
  value: string
  icon: ComponentType<{ className?: string }>
  delta?: number | null
  deltaLabel?: string
  subText?: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
}

const TONE_RING: Record<NonNullable<KpiTileProps['tone']>, string> = {
  default: 'border-border',
  success: 'border-emerald-200 bg-emerald-50/30',
  warning: 'border-amber-200 bg-amber-50/30',
  danger: 'border-red-200 bg-red-50/30',
}

const TONE_ICON: Record<NonNullable<KpiTileProps['tone']>, string> = {
  default: 'bg-muted text-foreground',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
}

function DeltaBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-[10px] text-muted-foreground">—</span>
  if (value > 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-600">
        <TrendingUp className="h-3 w-3" />+{value}%
      </span>
    )
  if (value < 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-500">
        <TrendingDown className="h-3 w-3" />
        {value}%
      </span>
    )
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
      <Minus className="h-3 w-3" />
      0%
    </span>
  )
}

function KpiTile({
  label,
  value,
  icon: Icon,
  delta,
  deltaLabel,
  subText,
  tone = 'default',
}: KpiTileProps) {
  return (
    <div className={`rounded-xl border ${TONE_RING[tone]} p-4 flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONE_ICON[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
        {delta !== undefined && (
          <div className="flex flex-col items-end">
            <DeltaBadge value={delta} />
            {deltaLabel && <span className="text-[10px] text-muted-foreground">{deltaLabel}</span>}
          </div>
        )}
      </div>
      <div>
        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
        <p className="text-xl font-bold mt-0.5 leading-tight">{value}</p>
        {subText && <p className="text-[11px] text-muted-foreground mt-0.5">{subText}</p>}
      </div>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function TileSkeleton() {
  return <div className="h-28 rounded-xl border bg-muted/30 animate-pulse" />
}

function ChartSkeleton({ height }: { height: number }) {
  return <div className="rounded-xl border bg-muted/30 animate-pulse" style={{ height }} />
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ExecutiveOverviewPage() {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(queryKeys.analytics.overview({ query: periodQuery }), () =>
    getExecutiveOverview(periodQuery)
  )
  const data = query.data ?? null
  const error = query.error ? query.error.message : null
  const loading = query.isLoading

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Executive Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real-time pulse of the clinic. Tiles refresh on page load; trend charts cover the last
          30–60 days.
          {data && (
            <span className="ml-1">
              · Last updated {new Date(data.generatedAt).toLocaleTimeString('en-GB')}
            </span>
          )}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── Tile grid ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {loading && Array.from({ length: 8 }).map((_, i) => <TileSkeleton key={i} />)}

        {data && (
          <>
            <KpiTile
              label="Today's Revenue"
              value={GHS_COMPACT(data.tiles.todayRevenue.value)}
              icon={Banknote}
              delta={data.tiles.todayRevenue.deltaPct}
              deltaLabel={`vs ${data.tiles.todayRevenue.vs}`}
            />

            <KpiTile
              label="Patients Seen Today"
              value={String(data.tiles.patientsSeenToday.value)}
              icon={Users}
              subText={`7-day avg: ${data.tiles.patientsSeenToday.sevenDayAverage}`}
            />

            <KpiTile
              label="Cash Position (MTD)"
              value={GHS_COMPACT(data.tiles.mtdCashPosition.value)}
              icon={Wallet}
              delta={data.tiles.mtdCashPosition.deltaPct}
              deltaLabel={`vs ${data.tiles.mtdCashPosition.vs}`}
              tone={data.tiles.mtdCashPosition.value < 0 ? 'danger' : 'success'}
            />

            <KpiTile
              label="No-Show Rate (7d)"
              value={`${data.tiles.noShowRate7d.value}%`}
              icon={CalendarX}
              subText={`${data.tiles.noShowRate7d.noShows} of ${data.tiles.noShowRate7d.totalAppointments} appts`}
              tone={
                data.tiles.noShowRate7d.value > 15
                  ? 'danger'
                  : data.tiles.noShowRate7d.value > 10
                    ? 'warning'
                    : 'default'
              }
            />

            <KpiTile
              label="Open A/R (Patients)"
              value={GHS_COMPACT(data.tiles.openAR.value)}
              icon={Coins}
              subText="Owed by patients"
            />

            <KpiTile
              label="Open A/P (Suppliers)"
              value={GHS_COMPACT(data.tiles.openAP.value)}
              icon={Coins}
              subText="Owed to suppliers"
            />

            <KpiTile
              label="Stock at Risk"
              value={String(data.tiles.stockAtRisk.value)}
              icon={Package}
              subText="Below reorder level"
              tone={data.tiles.stockAtRisk.value > 0 ? 'warning' : 'default'}
            />

            <KpiTile
              label="Credentials Expiring"
              value={String(data.tiles.credentialsExpiring30d.value)}
              icon={ShieldAlert}
              subText="Within 30 days"
              tone={data.tiles.credentialsExpiring30d.value > 0 ? 'warning' : 'default'}
            />

            <KpiTile
              label="Insurance Backlog"
              value={GHS_COMPACT(data.tiles.insuranceBacklog.value)}
              icon={ShieldAlert}
              subText={`${data.tiles.insuranceBacklog.records} unreconciled`}
              tone={data.tiles.insuranceBacklog.value > 0 ? 'warning' : 'default'}
            />

            <KpiTile
              label="Sync Errors (24h)"
              value={String(data.tiles.syncErrors24h.value)}
              icon={AlertTriangle}
              tone={data.tiles.syncErrors24h.value > 0 ? 'warning' : 'default'}
            />

            <KpiTile
              label="Patient Data Completeness"
              value={`${data.tiles.patientCompletenessPct.withPhonePct}%`}
              icon={Users}
              subText={`Phone · email: ${data.tiles.patientCompletenessPct.withEmailPct}%`}
              tone={data.tiles.patientCompletenessPct.withPhonePct < 80 ? 'warning' : 'default'}
            />
          </>
        )}
      </div>

      {/* ── Trend charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold">Revenue trend (last 60 days)</h2>
            <span className="text-[11px] text-muted-foreground">Stacked by payment method</span>
          </div>
          {loading ? (
            <ChartSkeleton height={260} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart
                data={data?.revenueTrend ?? []}
                margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10 }}
                  tickFormatter={SHORT_DAY}
                  minTickGap={20}
                />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => GHS_COMPACT(v)} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  labelFormatter={(label) => SHORT_DAY(label as string)}
                  formatter={(value, name) => [GHS(value as number), name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
                <Area
                  type="monotone"
                  stackId="rev"
                  dataKey="cash"
                  name="Cash"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  stackId="rev"
                  dataKey="card"
                  name="Card"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  stackId="rev"
                  dataKey="momo"
                  name="MoMo"
                  stroke="#f59e0b"
                  fill="#f59e0b"
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  stackId="rev"
                  dataKey="insurance"
                  name="Insurance"
                  stroke="#8b5cf6"
                  fill="#8b5cf6"
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  stackId="rev"
                  dataKey="transfer"
                  name="Transfer"
                  stroke="#06b6d4"
                  fill="#06b6d4"
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  stackId="rev"
                  dataKey="other"
                  name="Other"
                  stroke="#94a3b8"
                  fill="#94a3b8"
                  fillOpacity={0.6}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold">Appointments (last 30 days)</h2>
            <span className="text-[11px] text-muted-foreground">
              Booked vs completed vs no-show
            </span>
          </div>
          {loading ? (
            <ChartSkeleton height={260} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={data?.appointmentTrend ?? []}
                margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10 }}
                  tickFormatter={SHORT_DAY}
                  minTickGap={20}
                />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  labelFormatter={(label) => SHORT_DAY(label as string)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
                <Bar dataKey="booked" name="Booked" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="noShow" name="No-show" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Action banner row ── */}
      {data &&
        (data.tiles.stockAtRisk.value > 0 || data.tiles.credentialsExpiring30d.value > 0) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-amber-900">Items needing attention</p>
              <ul className="mt-1 text-amber-800 list-disc list-inside space-y-0.5">
                {data.tiles.stockAtRisk.value > 0 && (
                  <li>
                    {data.tiles.stockAtRisk.value} inventory item
                    {data.tiles.stockAtRisk.value === 1 ? '' : 's'} below reorder level — review on
                    the Store / Inventory page
                  </li>
                )}
                {data.tiles.credentialsExpiring30d.value > 0 && (
                  <li>
                    {data.tiles.credentialsExpiring30d.value} staff credential
                    {data.tiles.credentialsExpiring30d.value === 1 ? '' : 's'} expiring within 30
                    days — review on the Staff page
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}

      {/* ── Helpful follow-up ── */}
      {!loading && data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-4 w-4" />
            For appointment detail, open the Operational tab.
          </div>
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4" />
            For service-level revenue and AR aging, open the Financial tab.
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Tiles reflect server time at last fetch — reload for a fresh snapshot.
          </div>
        </div>
      )}
    </div>
  )
}
