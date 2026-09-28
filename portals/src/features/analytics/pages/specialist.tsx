import {
  Banknote,
  Building2,
  Clock,
  Coins,
  HandCoins,
  Loader2,
  Percent,
  Receipt,
  Stethoscope,
  Users,
} from 'lucide-react'
import { type ComponentType, useMemo } from 'react'
import {
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAnalyticsPeriod } from '@/features/analytics/period-context'
import {
  buildPeriodQuery,
  type CommissionAnalytics,
  getCommissionAnalytics,
  getSpecialistExtended,
  type SpecialistExtendedAnalytics,
} from '@/lib/actions/analytics'
import { useApiQuery } from '@/lib/query'
import { formatAmount } from '@/shared/utils/currency'

const COMMISSION_KEY = (period: string) =>
  ['analytics', 'specialist', 'commission', period] as const
const SPECIALIST_EXTENDED_KEY = (period: string) =>
  ['analytics', 'specialist', 'extended', period] as const

const GHS = (n: number) => `GHS ${formatAmount(n)}`

const GHS_COMPACT = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `GHS ${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `GHS ${(n / 1_000).toFixed(1)}K`
  return GHS(n)
}

const MONTH_SHORT: Record<string, string> = {
  '01': 'Jan',
  '02': 'Feb',
  '03': 'Mar',
  '04': 'Apr',
  '05': 'May',
  '06': 'Jun',
  '07': 'Jul',
  '08': 'Aug',
  '09': 'Sep',
  '10': 'Oct',
  '11': 'Nov',
  '12': 'Dec',
}
function formatMonthLabel(yyyymm: string): string {
  const [year, month] = yyyymm.split('-')
  return `${MONTH_SHORT[month] ?? month} '${year.slice(2)}`
}

// ── Tile + Section primitives ─────────────────────────────────────────────────

interface TileProps {
  label: string
  value: string
  icon: ComponentType<{ className?: string }>
  subText?: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
}

const TONE_RING: Record<NonNullable<TileProps['tone']>, string> = {
  default: 'border-border',
  success: 'border-emerald-200 bg-emerald-50/30',
  warning: 'border-amber-200 bg-amber-50/30',
  danger: 'border-red-200 bg-red-50/30',
}
const TONE_ICON: Record<NonNullable<TileProps['tone']>, string> = {
  default: 'bg-muted text-foreground',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
}

function Tile({ label, value, icon: Icon, subText, tone = 'default' }: TileProps) {
  return (
    <div className={`rounded-xl border ${TONE_RING[tone]} p-4 flex flex-col gap-2`}>
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONE_ICON[tone]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
        <p className="text-xl font-bold mt-0.5 leading-tight">{value}</p>
        {subText && <p className="text-[11px] text-muted-foreground mt-0.5">{subText}</p>}
      </div>
    </div>
  )
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  )
}

const FUNNEL_COLORS = ['#94a3b8', '#f59e0b', '#10b981']

// ─────────────────────────────────────────────────────────────────────────────

export default function SpecialistAnalyticsPage() {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const commissionQuery = useApiQuery(COMMISSION_KEY(periodQuery), () =>
    getCommissionAnalytics(periodQuery)
  )
  const extendedQuery = useApiQuery(SPECIALIST_EXTENDED_KEY(periodQuery), () =>
    getSpecialistExtended(periodQuery)
  )
  const data = commissionQuery.data ?? null
  const extended = extendedQuery.data ?? null
  const error = commissionQuery.error ? commissionQuery.error.message : null
  const loading = commissionQuery.isLoading || extendedQuery.isLoading

  // Top 12 specialists by outstanding for the chart; deeper drill-down sits in
  // the full table below.
  const topByOutstanding = useMemo(() => {
    if (!data) return []
    return [...data.perSpecialist].sort((a, b) => b.outstanding - a.outstanding).slice(0, 12)
  }, [data])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading…
      </div>
    )
  }
  if (error) {
    return (
      <div className="m-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Specialist & Commission</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Specialist commission liability and payout health. The funnel walks the lifetime amounts
          through Accrued → Payable → Paid; the per-specialist table shows who's owed what.
        </p>
      </div>

      {/* ── Tiles ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Total accrued (lifetime)"
          value={GHS_COMPACT(data.tiles.totalAccrued)}
          icon={Coins}
          subText={`${data.tiles.activeSpecialistCount} active specialist${data.tiles.activeSpecialistCount === 1 ? '' : 's'}`}
        />
        <Tile
          label="Payable now"
          value={GHS_COMPACT(data.tiles.totalPayable)}
          icon={HandCoins}
          subText="Earned but not yet paid out"
          tone={data.tiles.totalPayable > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Paid (lifetime)"
          value={GHS_COMPACT(data.tiles.totalPaid)}
          icon={Banknote}
          tone="success"
        />
        <Tile
          label="Outstanding"
          value={GHS_COMPACT(data.tiles.outstanding)}
          icon={Receipt}
          subText={`Realisation ${data.tiles.realizationLifetimePct}%`}
          tone={
            data.tiles.realizationLifetimePct < 60 && data.tiles.totalAccrued > 0
              ? 'warning'
              : 'default'
          }
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Avg payout cycle"
          value={`${data.tiles.avgPayoutCycleDays} days`}
          icon={Clock}
          subText={`Median ${data.tiles.medianPayoutCycleDays}d (last 90d)`}
          tone={data.tiles.avgPayoutCycleDays > 60 ? 'warning' : 'default'}
        />
        <Tile
          label="Payouts (12mo)"
          value={String(data.tiles.payoutCount12mo)}
          icon={Receipt}
          subText="Posted or paid"
        />
        <Tile
          label="Withholding tax (12mo)"
          value={GHS_COMPACT(data.tiles.totalWithholding12mo)}
          icon={Percent}
          subText={`${data.tiles.withholdingTaxPct}% effective`}
        />
        <Tile
          label="Active specialists"
          value={String(data.tiles.activeSpecialistCount)}
          icon={Users}
          subText="With an active ledger"
        />
      </div>

      {/* ── Funnel + per-specialist chart side-by-side on wide screens ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Accrued → Payable → Paid (lifetime)"
          description="Each step shows the cumulative amount across all specialists. The taper from one step to the next is the realisation gap."
        >
          {data.tiles.totalAccrued === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No commission accrued yet.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <FunnelChart>
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  formatter={(v) => [GHS(v as number), '']}
                />
                <Funnel
                  data={data.funnel}
                  dataKey="amount"
                  nameKey="stage"
                  isAnimationActive={false}
                >
                  {data.funnel.map((_, i) => (
                    <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                  ))}
                  <LabelList
                    position="right"
                    fill="#374151"
                    stroke="none"
                    dataKey="stage"
                    style={{ fontSize: 11 }}
                  />
                  <LabelList
                    position="center"
                    fill="white"
                    stroke="none"
                    dataKey="amount"
                    formatter={(v) => GHS_COMPACT(v as number)}
                    style={{ fontSize: 11, fontWeight: 600 }}
                  />
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard
          title="Outstanding by specialist (top 12)"
          description="Accrued minus paid. The biggest bar is who's owed the most."
        >
          {topByOutstanding.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Nothing outstanding.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, topByOutstanding.length * 28)}>
              <LineChart
                data={topByOutstanding.map((s) => ({
                  name: s.name.length > 18 ? `${s.name.slice(0, 16)}…` : s.name,
                  outstanding: s.outstanding,
                }))}
                layout="vertical"
                margin={{ top: 0, right: 60, left: 24, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => GHS_COMPACT(v as number)}
                />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={140} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  formatter={(v) => [GHS(v as number), 'Outstanding']}
                />
                <Line
                  type="monotone"
                  dataKey="outstanding"
                  stroke="#f59e0b"
                  strokeWidth={0}
                  dot={{ r: 4, fill: '#f59e0b' }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      {/* ── Realization trend ── */}
      <SectionCard
        title="Realisation trend (last 12 months)"
        description="Monthly commission accrued vs paid. The gap is what's still owed for that vintage of services."
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data.trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey="month" tickFormatter={formatMonthLabel} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => GHS_COMPACT(v as number)} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
              labelFormatter={(l) => formatMonthLabel(l as string)}
              formatter={(v, name) =>
                name === 'realizationPct' ? [`${v}%`, 'Realisation'] : [GHS(v as number), name]
              }
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
            <Line
              type="monotone"
              dataKey="accrued"
              name="Accrued"
              stroke="#94a3b8"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="paid"
              name="Paid"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* ── Per-specialist table ── */}
      <SectionCard
        title="Per-specialist ledger"
        description={`${data.perSpecialist.length} specialist${data.perSpecialist.length === 1 ? '' : 's'} with non-zero activity. Sorted by payable descending — the top row needs paying first.`}
      >
        {data.perSpecialist.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No commissions recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="pb-1 text-left font-medium">Specialist</th>
                  <th className="pb-1 text-left font-medium">Specialty</th>
                  <th className="pb-1 text-right font-medium">Accrued</th>
                  <th className="pb-1 text-right font-medium">Payable</th>
                  <th className="pb-1 text-right font-medium">Paid</th>
                  <th className="pb-1 text-right font-medium">Outstanding</th>
                  <th className="pb-1 text-right font-medium">Realisation %</th>
                </tr>
              </thead>
              <tbody>
                {data.perSpecialist.map((row) => (
                  <tr key={row.specialistId} className="border-b last:border-0">
                    <td className="py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span>{row.name}</span>
                        {!row.isActive && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground border border-border">
                            inactive
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 text-muted-foreground text-xs">{row.specialty ?? '—'}</td>
                    <td className="py-1.5 text-right tabular-nums">{GHS(row.accrued)}</td>
                    <td
                      className={`py-1.5 text-right tabular-nums ${
                        row.payable > 0 ? 'font-medium text-amber-600' : 'text-muted-foreground'
                      }`}
                    >
                      {GHS(row.payable)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-emerald-600">
                      {GHS(row.paid)}
                    </td>
                    <td
                      className={`py-1.5 text-right tabular-nums ${
                        row.outstanding > 0 ? 'font-medium' : 'text-muted-foreground'
                      }`}
                    >
                      {GHS(row.outstanding)}
                    </td>
                    <td
                      className={`py-1.5 text-right tabular-nums font-medium ${
                        row.realizationPct >= 80
                          ? 'text-emerald-600'
                          : row.realizationPct >= 50
                            ? 'text-amber-600'
                            : 'text-red-500'
                      }`}
                    >
                      {row.realizationPct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── Top earners last 12 months ── */}
      <SectionCard
        title="Top earners (last 12 months paid)"
        description="Specialists ranked by commissions actually paid out in the last year."
      >
        {data.topEarners.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No payouts in the last 12 months yet.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {data.topEarners.map((earner, idx) => (
              <li
                key={earner.specialistId}
                className="flex items-center gap-3 py-1 border-b border-border last:border-0 text-sm"
              >
                <span className="w-6 text-right text-xs font-mono text-muted-foreground">
                  {idx + 1}.
                </span>
                <Stethoscope className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium">{earner.name}</p>
                  {earner.specialty && (
                    <p className="text-[11px] text-muted-foreground truncate">{earner.specialty}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {earner.paidCount} commission{earner.paidCount === 1 ? '' : 's'}
                </span>
                <span className="text-sm font-semibold tabular-nums w-28 text-right">
                  {GHS(earner.paidTotal)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          For tax (VAT / NHIL / GET Fund) summaries, open Financial &rsaquo; Expenses tab.
        </div>
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          For payroll PAYE/SSNIT trends, open Workforce &rsaquo; Payroll tab.
        </div>
      </div>

      {/* ── Phase 2D — sessions / no-show / retention by specialist ── */}
      {extended && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
            <Tile
              label="Total sessions (period)"
              value={String(extended.tiles.totalSessions)}
              icon={Stethoscope}
            />
            <Tile
              label="Overall no-show rate"
              value={`${extended.tiles.overallNoShowPct}%`}
              icon={Percent}
              tone={extended.tiles.overallNoShowPct > 15 ? 'danger' : 'default'}
            />
            <Tile
              label="Returning patients"
              value={String(extended.tiles.totalReturningPatients)}
              icon={Users}
            />
            <Tile
              label="Overall retention"
              value={`${extended.tiles.overallRetentionPct}%`}
              icon={Users}
              tone={extended.tiles.overallRetentionPct < 30 ? 'warning' : 'success'}
            />
          </div>

          <SectionCard title="Per-specialist productivity">
            {extended.perSpecialist.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">
                No specialist activity in the selected window.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-medium pb-1">Specialist</th>
                    <th className="text-right font-medium pb-1">Sessions</th>
                    <th className="text-right font-medium pb-1">Completion</th>
                    <th className="text-right font-medium pb-1">No-show</th>
                    <th className="text-right font-medium pb-1">Patients</th>
                    <th className="text-right font-medium pb-1">Returning</th>
                    <th className="text-right font-medium pb-1">Retention</th>
                  </tr>
                </thead>
                <tbody>
                  {extended.perSpecialist.slice(0, 15).map((s) => (
                    <tr key={s.specialistId} className="border-t">
                      <td className="py-1.5">
                        {s.name}
                        {s.specialty && (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            ({s.specialty})
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{s.totalSessions}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.completionRatePct}%</td>
                      <td className="py-1.5 text-right tabular-nums">{s.noShowRatePct}%</td>
                      <td className="py-1.5 text-right tabular-nums">{s.patientCount}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.returningCount}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">
                        {s.retentionRatePct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>
        </>
      )}
    </div>
  )
}
