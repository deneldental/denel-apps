import {
  AlertOctagon,
  Banknote,
  CalendarCheck2,
  CalendarX,
  Clock,
  FlaskConical,
  Hourglass,
  Loader2,
  Package,
  PackageX,
  Timer,
  TrendingDown,
  Users,
} from 'lucide-react'
import { type ComponentType, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAnalyticsPeriod } from '@/features/analytics/period-context'
import {
  type AppointmentOperational,
  buildPeriodQuery,
  getOperationalAppointments,
  getOperationalInventory,
  getOperationalLab,
  type InventoryOperational,
  type LabOperational,
} from '@/lib/actions/analytics'
import { useApiQuery } from '@/lib/query'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { formatAmount } from '@/shared/utils/currency'

const OPERATIONAL_APPOINTMENTS_KEY = (period: string) =>
  ['analytics', 'operational', 'appointments', period] as const
const OPERATIONAL_LAB_KEY = (period: string) => ['analytics', 'operational', 'lab', period] as const
const OPERATIONAL_INVENTORY_KEY = (period: string) =>
  ['analytics', 'operational', 'inventory', period] as const

// ── Small KPI tile (mirrors the executive overview style) ─────────────────────

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

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      Loading…
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Operational analytics — Appointments | Lab | Inventory
// ─────────────────────────────────────────────────────────────────────────────

type TabId = 'appointments' | 'lab' | 'inventory'
const VALID_TABS: TabId[] = ['appointments', 'lab', 'inventory']
function isTabId(v: string | null): v is TabId {
  return v !== null && (VALID_TABS as string[]).includes(v)
}

export default function OperationalAnalyticsPage({ printMode = false }: { printMode?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab: TabId = isTabId(searchParams.get('tab'))
    ? (searchParams.get('tab') as TabId)
    : 'appointments'

  function setTab(t: TabId) {
    const next = new URLSearchParams(searchParams)
    if (t === 'appointments') next.delete('tab')
    else next.set('tab', t)
    setSearchParams(next, { replace: true })
  }

  if (printMode) {
    return (
      <div className="flex flex-col gap-8 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operational Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Daily-ops dashboards: appointment funnel, lab pipeline, inventory health.
          </p>
        </div>
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold border-b pb-1">Appointments</h2>
          <AppointmentsTab />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold border-b pb-1">Lab</h2>
          <LabTab />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold border-b pb-1">Inventory</h2>
          <InventoryTab />
        </section>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Operational Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Daily-ops dashboards for the receptionist and operations lead. Windows are fixed: 30-day
          rolling for appointments, current snapshot for lab pipeline, current snapshot for
          inventory.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabId)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
          <TabsTrigger value="lab">Lab</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>

        <TabsContent value="appointments" className="space-y-4">
          <AppointmentsTab />
        </TabsContent>

        <TabsContent value="lab" className="space-y-4">
          <LabTab />
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <InventoryTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Appointments tab ────────────────────────────────────────────────────────

const STAGE_COLORS = ['#6366f1', '#4f46e5', '#7c3aed', '#9333ea', '#10b981']
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function heatBackground(value: number, max: number): string {
  if (value === 0 || max === 0) return 'rgb(243, 244, 246)' // slate-100
  const intensity = Math.sqrt(value / max)
  const lightness = Math.round(92 - intensity * 60)
  return `hsl(220, 70%, ${lightness}%)`
}

function heatText(value: number, max: number): string {
  if (value === 0 || max === 0) return 'rgb(148, 163, 184)' // slate-400
  const intensity = Math.sqrt(value / max)
  return intensity > 0.55 ? 'white' : 'rgb(30, 41, 59)'
}

function AppointmentsTab() {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(OPERATIONAL_APPOINTMENTS_KEY(periodQuery), () =>
    getOperationalAppointments(periodQuery)
  )
  const data = query.data ?? null
  const error = query.error ? query.error.message : null
  const loading = query.isLoading

  // Pivot DoW heat into a 2D map keyed by (dow, hour) for grid rendering
  const heatGrid = useMemo(() => {
    if (!data) return null
    const grid = new Map<string, number>()
    for (const cell of data.dowHeat) grid.set(`${cell.dow}_${cell.hour}`, cell.count)
    const hours = Array.from(new Set(data.dowHeat.map((c) => c.hour))).sort((a, b) => a - b)
    return { grid, hours }
  }, [data])

  if (loading) return <PageLoader />
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    )
  }
  if (!data) return null

  return (
    <>
      {/* Tile row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Total appointments (30d)"
          value={String(data.tiles.totalAppointments)}
          icon={Users}
        />
        <Tile
          label="Completed (30d)"
          value={String(data.tiles.completed)}
          icon={CalendarCheck2}
          subText={`${data.tiles.totalAppointments > 0 ? Math.round((data.tiles.completed / data.tiles.totalAppointments) * 100) : 0}% of total`}
        />
        <Tile
          label="No-show rate (30d)"
          value={`${data.tiles.noShowRate}%`}
          icon={CalendarX}
          subText={`${data.tiles.noShow} of ${data.tiles.totalAppointments}`}
          tone={
            data.tiles.noShowRate > 15
              ? 'danger'
              : data.tiles.noShowRate > 10
                ? 'warning'
                : 'default'
          }
        />
        <Tile
          label="Avg lead time"
          value={`${data.tiles.avgLeadDays} days`}
          icon={Timer}
          subText="From booking to appointment"
        />
      </div>

      {/* Funnel + DoW heat side-by-side on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Status funnel (last 30 days)"
          description="Scheduled → Confirmed → Checked-in → In-chair → Completed. No-shows and cancellations sit off-funnel."
        >
          <ResponsiveContainer width="100%" height={260}>
            <FunnelChart>
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
                formatter={(v) => [v, 'Count']}
              />
              <Funnel data={data.funnel} dataKey="count" nameKey="stage" isAnimationActive={false}>
                {data.funnel.map((_, i) => (
                  <Cell key={i} fill={STAGE_COLORS[i % STAGE_COLORS.length]} />
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
                  dataKey="count"
                  style={{ fontSize: 11, fontWeight: 600 }}
                />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
          <div className="flex gap-4 text-xs pt-3 border-t mt-2">
            <span className="text-muted-foreground">
              No-show: <strong className="text-foreground">{data.lost.noShow}</strong>
            </span>
            <span className="text-muted-foreground">
              Cancelled: <strong className="text-foreground">{data.lost.cancelled}</strong>
            </span>
            <span className="text-muted-foreground ml-auto">
              Cancellation rate:{' '}
              <strong className="text-foreground">{data.tiles.cancellationRate}%</strong>
            </span>
          </div>
        </SectionCard>

        <SectionCard
          title="Booking density by day & hour"
          description="Where the clinic is busiest. Hours 8 AM – 9 PM."
        >
          {heatGrid && (
            <div className="overflow-x-auto">
              <div className="inline-block">
                {/* Hour header */}
                <div className="flex gap-px text-[10px] text-muted-foreground pl-10 mb-1">
                  {heatGrid.hours.map((h) => (
                    <div key={h} className="w-7 text-center">
                      {h}
                    </div>
                  ))}
                </div>
                {DOW_LABELS.map((label, dow) => (
                  <div key={dow} className="flex items-center gap-px mb-px">
                    <div className="w-10 text-[10px] text-muted-foreground font-medium pr-1">
                      {label}
                    </div>
                    {heatGrid.hours.map((h) => {
                      const count = heatGrid.grid.get(`${dow}_${h}`) ?? 0
                      return (
                        <div
                          key={h}
                          className="w-7 h-7 rounded-sm flex items-center justify-center text-[10px] font-medium"
                          style={{
                            backgroundColor: heatBackground(count, data.maxHeat),
                            color: heatText(count, data.maxHeat),
                          }}
                          title={`${label} ${h}:00 — ${count} appointment${count === 1 ? '' : 's'}`}
                        >
                          {count > 0 ? count : ''}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">
                Max in any slot: <strong>{data.maxHeat}</strong> appointment
                {data.maxHeat === 1 ? '' : 's'}
              </p>
            </div>
          )}
        </SectionCard>
      </div>

      {/* No-show by type + lead time histogram */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="No-show rate by appointment type"
          description="Sorted by volume. Helps decide where to invest reminder effort."
        >
          {data.noShowByType.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No appointments in window
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="pb-1 text-left font-medium">Type</th>
                  <th className="pb-1 text-right font-medium">Total</th>
                  <th className="pb-1 text-right font-medium">Completed</th>
                  <th className="pb-1 text-right font-medium">No-show</th>
                  <th className="pb-1 text-right font-medium">No-show %</th>
                </tr>
              </thead>
              <tbody>
                {data.noShowByType.map((row) => (
                  <tr key={row.type} className="border-b last:border-0">
                    <td className="py-1.5 capitalize">{row.type}</td>
                    <td className="py-1.5 text-right tabular-nums">{row.total}</td>
                    <td className="py-1.5 text-right tabular-nums text-emerald-600">
                      {row.completed}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{row.noShow}</td>
                    <td
                      className={`py-1.5 text-right tabular-nums font-medium ${
                        row.noShowRate > 15
                          ? 'text-red-500'
                          : row.noShowRate > 10
                            ? 'text-amber-600'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {row.noShowRate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard
          title="Lead time distribution"
          description="How far in advance patients book. Long-tail bookings = healthier pipeline."
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.leadHistogram} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Bar dataKey="count" name="Appointments" fill="#3b82f6" radius={[3, 3, 0, 0]}>
                <LabelList
                  dataKey="count"
                  position="top"
                  style={{ fontSize: 10, fontWeight: 600, fill: '#374151' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-muted-foreground mt-2">
            Average: <strong>{data.tiles.avgLeadDays} days</strong>
          </p>
        </SectionCard>
      </div>

      {/* ── Chair / doctor utilization (Phase 2B) ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <Tile
          label="Avg chair time"
          value={`${data.tiles.avgActualMinutes} min`}
          icon={Clock}
          subText={`Scheduled: ${data.tiles.avgScheduledMinutes} min`}
        />
        <Tile
          label="Chair utilization ratio"
          value={`${data.tiles.utilizationRatioPct}%`}
          icon={Timer}
          subText="actual / scheduled"
          tone={
            data.tiles.utilizationRatioPct > 110
              ? 'warning'
              : data.tiles.utilizationRatioPct < 70
                ? 'warning'
                : 'success'
          }
        />
        <Tile
          label="Confirmation response rate"
          value={`${data.tiles.confirmationResponseRatePct}%`}
          icon={CalendarCheck2}
          subText={`Yes rate: ${data.tiles.confirmationYesRatePct}%`}
        />
        <Tile
          label="Confirmation yes rate"
          value={`${data.tiles.confirmationYesRatePct}%`}
          icon={CalendarCheck2}
          tone={data.tiles.confirmationYesRatePct < 50 ? 'warning' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Doctor utilization"
          description="Appointments + chair hours per doctor over the period."
        >
          {data.doctorUtilization.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">No doctor activity.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-1">Doctor ID</th>
                  <th className="text-right font-medium pb-1">Appts</th>
                  <th className="text-right font-medium pb-1">Completed</th>
                  <th className="text-right font-medium pb-1">No-show</th>
                  <th className="text-right font-medium pb-1">Chair (hr)</th>
                  <th className="text-right font-medium pb-1">Completion %</th>
                </tr>
              </thead>
              <tbody>
                {data.doctorUtilization.slice(0, 10).map((d) => (
                  <tr key={d.doctorId} className="border-t">
                    <td
                      className="py-1.5 truncate max-w-[140px] font-mono text-[10px]"
                      title={d.doctorId}
                    >
                      {d.doctorId.slice(0, 8)}…
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{d.appts}</td>
                    <td className="py-1.5 text-right tabular-nums">{d.completed}</td>
                    <td className="py-1.5 text-right tabular-nums">{d.noShow}</td>
                    <td className="py-1.5 text-right tabular-nums">{d.chairHours}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">
                      {d.completionRatePct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard
          title="Confirmation funnel"
          description="Outbound confirmations vs. patient responses."
        >
          <div className="space-y-3">
            <FunnelRow
              label="Confirmations sent"
              value={data.confirmationFunnel.sent}
              total={data.confirmationFunnel.total}
            />
            <FunnelRow
              label="Responded — yes"
              value={data.confirmationFunnel.respondedYes}
              total={data.confirmationFunnel.sent}
              tone="success"
            />
            <FunnelRow
              label="Responded — no"
              value={data.confirmationFunnel.respondedNo}
              total={data.confirmationFunnel.sent}
              tone="danger"
            />
          </div>
        </SectionCard>
      </div>
    </>
  )
}

function FunnelRow({
  label,
  value,
  total,
  tone = 'default',
}: {
  label: string
  value: number
  total: number
  tone?: 'default' | 'success' | 'danger'
}) {
  const pct = total > 0 ? Math.round((value / total) * 1000) / 10 : 0
  const barTone =
    tone === 'success' ? 'bg-emerald-500' : tone === 'danger' ? 'bg-red-500' : 'bg-indigo-500'
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="tabular-nums font-medium">
          {value} ({pct}%)
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full bg-muted rounded overflow-hidden">
        <div className={`h-full ${barTone}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

// ─── Lab tab ──────────────────────────────────────────────────────────────────

const LAB_STAGE_COLORS = ['#6366f1', '#f59e0b', '#06b6d4', '#10b981']

function LabTab() {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(OPERATIONAL_LAB_KEY(periodQuery), () => getOperationalLab(periodQuery))
  const data = query.data ?? null
  const error = query.error ? query.error.message : null
  const loading = query.isLoading

  if (loading) return <PageLoader />
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    )
  }
  if (!data) return null

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Active cases"
          value={String(data.tiles.activeCases)}
          icon={FlaskConical}
          subText="In pipeline now"
        />
        <Tile
          label="Completed (90d)"
          value={String(data.tiles.completed90d)}
          icon={CalendarCheck2}
        />
        <Tile
          label="Delayed"
          value={String(data.tiles.delayed)}
          icon={AlertOctagon}
          tone={data.tiles.delayed > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Avg turnaround"
          value={`${data.tiles.avgTurnaroundDays} days`}
          icon={Hourglass}
          subText="Weighted by case volume"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Pipeline funnel (snapshot)"
          description="Live pipeline counts. Delayed and cancelled sit off-funnel."
        >
          <ResponsiveContainer width="100%" height={260}>
            <FunnelChart>
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
                formatter={(v) => [v, 'Count']}
              />
              <Funnel data={data.funnel} dataKey="count" nameKey="stage" isAnimationActive={false}>
                {data.funnel.map((_, i) => (
                  <Cell key={i} fill={LAB_STAGE_COLORS[i % LAB_STAGE_COLORS.length]} />
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
                  dataKey="count"
                  style={{ fontSize: 11, fontWeight: 600 }}
                />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
          <div className="flex gap-4 text-xs pt-3 border-t mt-2">
            <span className="text-muted-foreground">
              Delayed: <strong className="text-amber-600">{data.sideline.delayed}</strong>
            </span>
            <span className="text-muted-foreground">
              Cancelled: <strong className="text-foreground">{data.sideline.cancelled}</strong>
            </span>
            <span className="text-muted-foreground ml-auto">
              Internal / External:{' '}
              <strong className="text-foreground">{data.domainMix.internal}</strong>
              {' / '}
              <strong className="text-foreground">{data.domainMix.external}</strong>
            </span>
          </div>
        </SectionCard>

        <SectionCard
          title="Vendor performance (last 90 days)"
          description="Completed cases, average turnaround, and on-time delivery rate per vendor."
        >
          {data.vendorPerformance.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No completed cases in the window
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="pb-1 text-left font-medium">Vendor</th>
                  <th className="pb-1 text-right font-medium">Completed</th>
                  <th className="pb-1 text-right font-medium">Avg TAT</th>
                  <th className="pb-1 text-right font-medium">On-time %</th>
                </tr>
              </thead>
              <tbody>
                {data.vendorPerformance.map((v) => (
                  <tr key={v.vendorId ?? v.vendorName} className="border-b last:border-0">
                    <td className="py-1.5 truncate max-w-[180px]" title={v.vendorName}>
                      {v.vendorName}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{v.completed}</td>
                    <td className="py-1.5 text-right tabular-nums">{v.avgTurnaroundDays}d</td>
                    <td
                      className={`py-1.5 text-right tabular-nums font-medium ${
                        v.onTimeRate === null
                          ? 'text-muted-foreground'
                          : v.onTimeRate >= 90
                            ? 'text-emerald-600'
                            : v.onTimeRate >= 75
                              ? 'text-amber-600'
                              : 'text-red-500'
                      }`}
                    >
                      {v.onTimeRate === null ? '—' : `${v.onTimeRate}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      {data.delayReasons.length > 0 && (
        <SectionCard
          title="Why cases are delayed"
          description="Current delayed cases grouped by reason."
        >
          <ResponsiveContainer width="100%" height={Math.max(160, data.delayReasons.length * 32)}>
            <BarChart
              layout="vertical"
              data={data.delayReasons}
              margin={{ top: 0, right: 32, left: 32, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis dataKey="reason" type="category" tick={{ fontSize: 11 }} width={140} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Bar dataKey="count" fill="#f59e0b" radius={[0, 3, 3, 0]}>
                <LabelList
                  dataKey="count"
                  position="right"
                  style={{ fontSize: 11, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      )}

      {/* ── Lab economics (Phase 2B) ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <Tile
          label="Lab cost (window)"
          value={ghsCompact(data.tiles.totalLabCost)}
          icon={Banknote}
        />
        <Tile
          label="Patient charges"
          value={ghsCompact(data.tiles.totalPatientCharge)}
          icon={Banknote}
        />
        <Tile
          label="Margin"
          value={ghsCompact(data.tiles.overallMargin)}
          icon={TrendingDown}
          subText={`${data.tiles.overallMarginPct}% margin`}
          tone={
            data.tiles.overallMarginPct < 20
              ? 'warning'
              : data.tiles.overallMarginPct > 40
                ? 'success'
                : 'default'
          }
        />
        <Tile
          label="Avg cost per case"
          value={ghsCompact(data.tiles.avgCostPerCase)}
          icon={FlaskConical}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Economics by domain" description="Internal vs external case economics.">
          {data.economicsByDomain.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">No cases in window.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-1">Domain</th>
                  <th className="text-right font-medium pb-1">Cases</th>
                  <th className="text-right font-medium pb-1">Avg cost</th>
                  <th className="text-right font-medium pb-1">Avg charge</th>
                  <th className="text-right font-medium pb-1">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {data.economicsByDomain.map((d) => (
                  <tr key={d.domain} className="border-t">
                    <td className="py-1.5 capitalize">{d.domain}</td>
                    <td className="py-1.5 text-right tabular-nums">{d.caseCount}</td>
                    <td className="py-1.5 text-right tabular-nums">{ghsCompact(d.avgLabCost)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {ghsCompact(d.avgPatientCharge)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-medium">{d.marginPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard title="Cost-per-case trend" description="Monthly lab cost vs patient charge.">
          {data.economicsMonthly.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">No cases in window.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={data.economicsMonthly}
                margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={ghsCompact} />
                <Tooltip formatter={(value, name) => [ghsCompact(value as number), name]} />
                <Bar
                  dataKey="avgLabCost"
                  name="Avg lab cost"
                  fill="#ef4444"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="avgPatientCharge"
                  name="Avg patient charge"
                  fill="#10b981"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>
    </>
  )
}

function ghsCompact(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `GHS ${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `GHS ${(n / 1_000).toFixed(1)}K`
  return `GHS ${formatAmount(n)}`
}

// ─── Inventory tab ───────────────────────────────────────────────────────────

function InventoryTab() {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(OPERATIONAL_INVENTORY_KEY(periodQuery), () =>
    getOperationalInventory(periodQuery)
  )
  const data = query.data ?? null
  const error = query.error ? query.error.message : null
  const loading = query.isLoading

  if (loading) return <PageLoader />
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    )
  }
  if (!data) return null

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Total SKUs" value={String(data.tiles.totalSkus)} icon={Package} />
        <Tile
          label="Low stock"
          value={String(data.tiles.lowStock)}
          icon={PackageX}
          subText="At or below reorder level"
          tone={data.tiles.lowStock > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Expiring soon"
          value={String(data.tiles.expiringSoon)}
          icon={Clock}
          subText="Within 90 days"
          tone={data.tiles.expiringSoon > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Already expired"
          value={String(data.tiles.expired)}
          icon={TrendingDown}
          tone={data.tiles.expired > 0 ? 'danger' : 'default'}
        />
      </div>

      <SectionCard
        title="Items below reorder level"
        description="Sorted by lowest stock first — top of the list is the most urgent restock."
      >
        {data.lowStock.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            All SKUs are above reorder level.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-1 text-left font-medium">Name</th>
                <th className="pb-1 text-left font-medium">Category</th>
                <th className="pb-1 text-right font-medium">Stock</th>
                <th className="pb-1 text-right font-medium">Reorder at</th>
              </tr>
            </thead>
            <tbody>
              {data.lowStock.slice(0, 50).map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-1.5">{row.name}</td>
                  <td className="py-1.5 text-muted-foreground capitalize">{row.category ?? '—'}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold text-red-500">
                    {row.stockQuantity}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {row.reorderLevel ?? 10}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.lowStock.length > 50 && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Showing 50 of {data.lowStock.length}. Open the Store / Inventory page for the full list.
          </p>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Stock by category" description="Units on hand, grouped by category.">
          {data.byCategory.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No inventory recorded.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, data.byCategory.length * 28)}>
              <BarChart
                layout="vertical"
                data={data.byCategory.slice(0, 15)}
                margin={{ top: 0, right: 60, left: 24, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis dataKey="category" type="category" tick={{ fontSize: 11 }} width={120} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                <Bar dataKey="totalUnits" name="Units" fill="#0ea5e9" radius={[0, 3, 3, 0]}>
                  <LabelList
                    dataKey="totalUnits"
                    position="right"
                    style={{ fontSize: 11, fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard
          title="Expiring within 90 days"
          description="Sorted by soonest expiry. Triage these before they become write-offs."
        >
          {data.expiringSoon.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Nothing expiring in the next 90 days.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="pb-1 text-left font-medium">Name</th>
                  <th className="pb-1 text-right font-medium">Stock</th>
                  <th className="pb-1 text-right font-medium">Days left</th>
                </tr>
              </thead>
              <tbody>
                {data.expiringSoon.slice(0, 25).map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-1.5">{row.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{row.stockQuantity}</td>
                    <td
                      className={`py-1.5 text-right tabular-nums font-medium ${
                        row.daysLeft <= 30
                          ? 'text-red-500'
                          : row.daysLeft <= 60
                            ? 'text-amber-600'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {row.daysLeft}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>
    </>
  )
}
