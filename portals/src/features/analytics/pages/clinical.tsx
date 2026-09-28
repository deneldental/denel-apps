import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileSignature,
  Loader2,
  Repeat,
  Smile,
  Stethoscope,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import { type ComponentType, useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAnalyticsPeriod } from '@/features/analytics/period-context'
import { useClinicalPreferences } from '@/features/clinical/use-clinical-preferences'
import {
  buildPeriodQuery,
  type ClinicalAnalytics,
  type ClinicalExtendedAnalytics,
  getClinicalAnalytics,
  getClinicalExtended,
} from '@/lib/actions/analytics'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { formatAmount } from '@/shared/utils/currency'

const CLINICAL_EXTENDED_KEY = (period: string) =>
  ['analytics', 'clinical', 'extended', period] as const

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

// ── FDI tooth-map grid ────────────────────────────────────────────────────────
// Adult permanent dentition only. Layout follows the dental chart convention:
//
//      Upper right          |       Upper left
//   18 17 16 15 14 13 12 11 | 21 22 23 24 25 26 27 28
//   48 47 46 45 44 43 42 41 | 31 32 33 34 35 36 37 38
//      Lower right          |       Lower left
//
// Row order matters for "patient-facing" feel — top row is upper jaw.

const FDI_UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11]
const FDI_UPPER_LEFT = [21, 22, 23, 24, 25, 26, 27, 28]
const FDI_LOWER_RIGHT = [48, 47, 46, 45, 44, 43, 42, 41]
const FDI_LOWER_LEFT = [31, 32, 33, 34, 35, 36, 37, 38]

interface ToothMapProps {
  /** Map of tooth → value (count, depth, etc.) */
  data: Record<number, number>
  max: number
  /** Hue (0-360) for the heat gradient. Defaults to blue. */
  hue?: number
  /** How to format the cell value in the tooltip + cell label. */
  formatValue: (value: number) => string
  /** Title for tooltips, like "Procedures" or "Caries". */
  metricLabel: string
}

function ToothMap({ data, max, hue = 220, formatValue, metricLabel }: ToothMapProps) {
  function cellBackground(value: number): string {
    if (value === 0 || max === 0) return 'rgb(243, 244, 246)'
    const intensity = Math.sqrt(value / max)
    const lightness = Math.round(92 - intensity * 60)
    return `hsl(${hue}, 70%, ${lightness}%)`
  }
  function cellText(value: number): string {
    if (value === 0 || max === 0) return 'rgb(148, 163, 184)'
    const intensity = Math.sqrt(value / max)
    return intensity > 0.55 ? 'white' : 'rgb(30, 41, 59)'
  }

  function ToothCell({ tooth }: { tooth: number }) {
    const value = data[tooth] ?? 0
    return (
      <div
        className="w-8 h-10 rounded-md border border-border/40 flex flex-col items-center justify-center text-[10px] font-medium select-none cursor-default"
        style={{ backgroundColor: cellBackground(value), color: cellText(value) }}
        title={`Tooth ${tooth} — ${metricLabel}: ${formatValue(value)}`}
      >
        <span className="text-[8px] opacity-70 leading-tight">{tooth}</span>
        <span className="text-[10px] font-semibold leading-tight">
          {value > 0 ? formatValue(value) : ''}
        </span>
      </div>
    )
  }

  return (
    <div className="inline-block">
      {/* Upper jaw */}
      <div className="flex gap-1">
        <div className="flex gap-px">
          {FDI_UPPER_RIGHT.map((t) => (
            <ToothCell key={t} tooth={t} />
          ))}
        </div>
        <div className="w-px bg-border mx-1" />
        <div className="flex gap-px">
          {FDI_UPPER_LEFT.map((t) => (
            <ToothCell key={t} tooth={t} />
          ))}
        </div>
      </div>
      <div className="my-1 border-t border-dashed border-border/60" />
      {/* Lower jaw */}
      <div className="flex gap-1">
        <div className="flex gap-px">
          {FDI_LOWER_RIGHT.map((t) => (
            <ToothCell key={t} tooth={t} />
          ))}
        </div>
        <div className="w-px bg-border mx-1" />
        <div className="flex gap-px">
          {FDI_LOWER_LEFT.map((t) => (
            <ToothCell key={t} tooth={t} />
          ))}
        </div>
      </div>
      {/* Anatomical labels */}
      <div className="flex justify-between mt-2 text-[9px] text-muted-foreground px-1">
        <span>Patient right</span>
        <span>Patient left</span>
      </div>
    </div>
  )
}

const STAGE_COLORS = ['#94a3b8', '#6366f1', '#7c3aed', '#9333ea', '#10b981']
const XRAY_PIE = ['#0ea5e9', '#f59e0b']

// ─────────────────────────────────────────────────────────────────────────────

export default function ClinicalAnalyticsPage() {
  const { period } = useAnalyticsPeriod()
  // Perio severity follows Settings → Clinical → Charting Preferences (S5-B).
  const { perio } = useClinicalPreferences()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const dataQuery = useApiQuery(queryKeys.analytics.clinical({ query: periodQuery }), () =>
    getClinicalAnalytics(periodQuery)
  )
  const extendedQuery = useApiQuery(CLINICAL_EXTENDED_KEY(periodQuery), () =>
    getClinicalExtended(periodQuery)
  )
  const data = dataQuery.data ?? null
  const extended = extendedQuery.data ?? null
  const error = dataQuery.error ? dataQuery.error.message : null
  const loading = dataQuery.isLoading || extendedQuery.isLoading

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

  const xrayPieData = [
    { name: 'Internal', value: data.xrayBySource.internal ?? 0 },
    { name: 'External', value: data.xrayBySource.external ?? 0 },
  ].filter((d) => d.value > 0)

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clinical Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The clinical lead's view: treatment-plan pipeline, where procedures land on the FDI grid,
          imaging volume, and consent + recare hygiene.
        </p>
      </div>

      {/* ── Tiles row 1 — treatment plans ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Total treatment plans"
          value={String(data.tiles.totalPlans)}
          icon={ClipboardList}
        />
        <Tile
          label="Acceptance rate"
          value={`${data.tiles.acceptanceRatePct}%`}
          icon={CheckCircle2}
          subText={`${data.tiles.accepted} accepted of decided`}
          tone={
            data.tiles.acceptanceRatePct >= 70
              ? 'success'
              : data.tiles.acceptanceRatePct >= 50
                ? 'default'
                : 'warning'
          }
        />
        <Tile
          label="Avg plan value"
          value={GHS_COMPACT(data.tiles.avgPlanValue)}
          icon={TrendingUp}
          subText={`Median ${GHS_COMPACT(data.tiles.medianPlanValue)}`}
        />
        <Tile
          label="Declined"
          value={String(data.tiles.declined)}
          icon={XCircle}
          subText={`${data.tiles.totalPlans > 0 ? Math.round((data.tiles.declined / data.tiles.totalPlans) * 1000) / 10 : 0}% of total`}
          tone={
            data.tiles.declined / Math.max(data.tiles.totalPlans, 1) > 0.2 ? 'warning' : 'default'
          }
        />
      </div>

      {/* ── Tiles row 2 — operational hygiene ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Pending medical records"
          value={String(data.tiles.pendingRecords)}
          icon={ClipboardCheck}
          subText={
            data.tiles.pendingRecords > 0
              ? `Avg ${data.tiles.avgHoursPending}h · max ${data.tiles.maxHoursPending}h`
              : 'All caught up'
          }
          tone={
            data.tiles.maxHoursPending > 48
              ? 'danger'
              : data.tiles.maxHoursPending > 24
                ? 'warning'
                : data.tiles.pendingRecords > 0
                  ? 'default'
                  : 'success'
          }
        />
        <Tile
          label="X-rays uploaded (12mo)"
          value={String(data.tiles.xrayTotal)}
          icon={Camera}
          subText={`${data.tiles.internalXrays} internal · ${data.tiles.externalXrays} external`}
        />
        <Tile
          label="Signed consents"
          value={String(data.tiles.consentsTotal)}
          icon={FileSignature}
          subText={`${data.tiles.consents90d} in last 90 days`}
        />
        <Tile
          label="Recare overdue"
          value={String(data.tiles.recareOverdue)}
          icon={Repeat}
          subText={`${data.tiles.recareActive} active plan${data.tiles.recareActive === 1 ? '' : 's'}`}
          tone={data.tiles.recareOverdue > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* ── Treatment plan funnel + plan value histogram ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Treatment plan funnel"
          description="All-time progression. Declined plans (lost revenue) sit off-funnel."
        >
          {data.tiles.totalPlans === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No treatment plans recorded yet.
            </p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <FunnelChart>
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 6 }}
                    formatter={(v) => [v, 'Plans']}
                  />
                  <Funnel
                    data={data.funnel}
                    dataKey="count"
                    nameKey="stage"
                    isAnimationActive={false}
                  >
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
              <div className="flex justify-between text-xs pt-3 border-t mt-2">
                <span className="text-muted-foreground">
                  Declined: <strong className="text-red-500">{data.tiles.declined}</strong>
                </span>
                <span className="text-muted-foreground">
                  In-progress:{' '}
                  <strong className="text-foreground">{data.decided.inProgress}</strong>
                </span>
                <span className="text-muted-foreground">
                  Completed: <strong className="text-emerald-600">{data.decided.completed}</strong>
                </span>
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard
          title="Plan value distribution"
          description="How treatment plans are priced. The right tail is your high-ticket pipeline."
        >
          {data.tiles.totalPlans === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No plans to chart.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={data.planValueHistogram}
                margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                <Bar dataKey="count" name="Plans" fill="#7c3aed" radius={[3, 3, 0, 0]}>
                  <LabelList
                    dataKey="count"
                    position="top"
                    style={{ fontSize: 10, fontWeight: 600, fill: '#374151' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      {/* ── Acceptance by doctor ── */}
      <SectionCard
        title="Acceptance rate by doctor (last 12 months)"
        description="Sorted by plan volume. Differences in acceptance % within similar volumes are worth conversation."
      >
        {data.byDoctor.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No plans created in the last 12 months.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-1 text-left font-medium">Doctor</th>
                <th className="pb-1 text-right font-medium">Total plans</th>
                <th className="pb-1 text-right font-medium">Accepted</th>
                <th className="pb-1 text-right font-medium">Declined</th>
                <th className="pb-1 text-right font-medium">Acceptance %</th>
              </tr>
            </thead>
            <tbody>
              {data.byDoctor.map((d) => (
                <tr key={d.doctorId} className="border-b last:border-0">
                  <td className="py-1.5 truncate max-w-[260px]" title={d.name}>
                    {d.name}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{d.total}</td>
                  <td className="py-1.5 text-right tabular-nums text-emerald-600">{d.accepted}</td>
                  <td className="py-1.5 text-right tabular-nums text-red-500">{d.declined}</td>
                  <td
                    className={`py-1.5 text-right tabular-nums font-medium ${
                      d.accepted + d.declined === 0
                        ? 'text-muted-foreground'
                        : d.acceptanceRate >= 70
                          ? 'text-emerald-600'
                          : d.acceptanceRate >= 50
                            ? 'text-amber-600'
                            : 'text-red-500'
                    }`}
                  >
                    {d.accepted + d.declined === 0 ? '—' : `${d.acceptanceRate}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* ── Tooth-map heat maps side-by-side ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SectionCard
          title="Where procedures land (FDI grid)"
          description="Treatment-plan items grouped by FDI tooth number. Darker = more procedures planned on that tooth, all-time."
        >
          {data.toothProcedureMax === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No tooth-specific procedures recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <ToothMap
                data={data.toothProcedureHeat}
                max={data.toothProcedureMax}
                hue={220}
                formatValue={(v) => String(v)}
                metricLabel="Procedures"
              />
              <p className="text-[10px] text-muted-foreground mt-3">
                Most-treated tooth: <strong>{data.toothProcedureMax}</strong> procedure
                {data.toothProcedureMax === 1 ? '' : 's'}
              </p>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Caries prevalence by tooth"
          description="Odontogram entries with a caries / decay condition, summed per FDI tooth. Identifies hot-spots that may warrant preventive focus."
        >
          {data.cariesMax === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No caries entries on file.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <ToothMap
                data={data.cariesByToothHeat}
                max={data.cariesMax}
                hue={0}
                formatValue={(v) => String(v)}
                metricLabel="Caries entries"
              />
              <p className="text-[10px] text-muted-foreground mt-3">
                Most affected: <strong>{data.cariesMax}</strong> caries record
                {data.cariesMax === 1 ? '' : 's'} on a single tooth
              </p>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Pocket depth tooth map (if data exists) ── */}
      {data.pocketDepthMax > 0 && (
        <SectionCard
          title="Average pocket depth (last 12 months)"
          description={`Mean pocket depth in mm per tooth. Anything ≥${perio.normalMaxMm + 1} mm is clinically actionable; ≥${perio.severeMinMm} mm is severe.`}
        >
          <div className="overflow-x-auto">
            <ToothMap
              data={Object.fromEntries(
                Object.entries(data.pocketDepthHeat).map(([k, v]) => [k, v.avg])
              )}
              max={data.pocketDepthMax}
              hue={30}
              formatValue={(v) => Number(v).toFixed(1)}
              metricLabel="Avg depth (mm)"
            />
            <p className="text-[10px] text-muted-foreground mt-3">
              Deepest avg pocket: <strong>{Number(data.pocketDepthMax).toFixed(1)} mm</strong>
            </p>
          </div>
        </SectionCard>
      )}

      {/* ── X-ray section ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SectionCard
          title="X-ray volume (last 12 months)"
          description="Monthly uploads. Watch for sustained drops — they often indicate operator-side workflow gaps."
        >
          {data.tiles.xrayTotal === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No x-rays uploaded.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.xrayTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="month" tickFormatter={formatMonthLabel} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  labelFormatter={(l) => formatMonthLabel(l as string)}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  name="X-rays"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Internal vs external" description="Source of imaging.">
          {xrayPieData.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={xrayPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                >
                  {xrayPieData.map((_, i) => (
                    <Cell key={i} fill={XRAY_PIE[i % XRAY_PIE.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="space-y-1 text-xs mt-2">
            {xrayPieData.map((row, i) => (
              <div key={row.name} className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: XRAY_PIE[i % XRAY_PIE.length] }}
                />
                <span>{row.name}</span>
                <span className="ml-auto tabular-nums font-medium">{row.value}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="By x-ray type (12mo)" description="Top types uploaded.">
          {data.xrayByType.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No typed x-rays.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.xrayByType.slice(0, 8).map((row) => (
                <li
                  key={row.type}
                  className="flex items-center justify-between py-1 border-b border-border last:border-0"
                >
                  <span className="truncate pr-2" title={row.type}>
                    {row.type}
                  </span>
                  <span className="tabular-nums font-medium">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* ── Quick reference ── */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Smile className="h-4 w-4" />
          Tooth grids use FDI notation. Cell tooltips show the exact value.
        </div>
        <div className="flex items-center gap-2">
          <Stethoscope className="h-4 w-4" />
          Acceptance % counts decisions only (accepted + declined). Plans still in 'presented' don't
          yet count.
        </div>
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Records older than 24h trigger an amber tile; older than 48h goes red.
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          For the workflow side of pending records, open the Clinical module.
        </div>
      </div>

      {/* ── Phase 2D — procedure completion / perio delta / prescriptions / records ── */}
      {extended && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
            <Tile
              label="Procedure completion"
              value={`${extended.tiles.overallProcedureCompletionPct}%`}
              icon={Clock}
              subText={`${extended.tiles.totalProcedureCompleted} / ${extended.tiles.totalProcedureItems}`}
              tone={
                extended.tiles.overallProcedureCompletionPct < 50
                  ? 'warning'
                  : extended.tiles.overallProcedureCompletionPct > 80
                    ? 'success'
                    : 'default'
              }
            />
            <Tile
              label="Avg pocket depth"
              value={`${extended.tiles.overallAvgPocketDepth} mm`}
              icon={Clock}
              tone={
                extended.tiles.overallAvgPocketDepth > perio.normalMaxMm ? 'warning' : 'default'
              }
            />
            <Tile
              label="Prescriptions (period)"
              value={String(extended.tiles.prescriptionCount)}
              icon={Clock}
            />
            <Tile
              label="Med record completeness"
              value={`${extended.tiles.medicalRecordCompletenessPct}%`}
              icon={Clock}
              subText={`${extended.tiles.completedApptsWithRecord} / ${extended.tiles.completedAppts}`}
              tone={extended.tiles.medicalRecordCompletenessPct < 70 ? 'warning' : 'success'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="Procedure completion by doctor">
              {extended.procedureByDoctor.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">
                  No treatment-plan items in window.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-left font-medium pb-1">Doctor</th>
                      <th className="text-right font-medium pb-1">Items</th>
                      <th className="text-right font-medium pb-1">Completed</th>
                      <th className="text-right font-medium pb-1">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extended.procedureByDoctor.slice(0, 12).map((d) => (
                      <tr key={d.doctorUserId ?? ''} className="border-t">
                        <td className="py-1.5">{d.doctorName ?? 'Unknown'}</td>
                        <td className="py-1.5 text-right tabular-nums">{d.totalItems}</td>
                        <td className="py-1.5 text-right tabular-nums">{d.completed}</td>
                        <td className="py-1.5 text-right tabular-nums font-medium">
                          {d.completionRatePct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </SectionCard>

            <SectionCard title="Top prescribed Prescriptions">
              {extended.prescriptionTop.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">
                  No prescriptions in window.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-left font-medium pb-1">Prescription</th>
                      <th className="text-right font-medium pb-1">Prescriptions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extended.prescriptionTop.map((p) => (
                      <tr key={p.medication} className="border-t">
                        <td className="py-2 text-sm max-w-[200px] truncate">{p.medication}</td>
                        <td className="py-1.5 text-right tabular-nums">{p.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  )
}
