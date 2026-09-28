import {
  Baby,
  Braces,
  CalendarPlus,
  Loader2,
  Smartphone,
  UserCheck,
  UserMinus,
  Users,
  UserX,
} from 'lucide-react'
import { type ComponentType, useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
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
import { useAnalyticsPeriod } from '@/features/analytics/period-context'
import {
  buildPeriodQuery,
  getPatientAnalytics,
  type PatientAnalytics,
} from '@/lib/actions/analytics'
import { useApiQuery } from '@/lib/query'
import { formatAmount } from '@/shared/utils/currency'

const PATIENT_ANALYTICS_KEY = (period: string) => ['analytics', 'patient', period] as const

const GHS = (n: number) => `GHS ${formatAmount(n)}`

const _GHS_COMPACT = (n: number) => {
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

// ── Tile + Section primitives (kept local — same visual language as the other
// analytics pages but cheap to inline so each page stays self-contained) ──────

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

// Gender colour map keeps the donut readable across rerenders
const GENDER_COLOR: Record<string, string> = {
  male: '#3b82f6',
  female: '#ec4899',
  other: '#8b5cf6',
  unspecified: '#94a3b8',
}
function genderColour(gender: string): string {
  return GENDER_COLOR[gender.toLowerCase()] ?? '#64748b'
}

const CATEGORY_PALETTE = ['#0ea5e9', '#a855f7', '#f59e0b', '#10b981', '#ef4444']

// ─────────────────────────────────────────────────────────────────────────────

export default function PatientAnalyticsPage() {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(PATIENT_ANALYTICS_KEY(periodQuery), () =>
    getPatientAnalytics(periodQuery)
  )
  const data = query.data ?? null
  const error = query.error ? query.error.message : null
  const loading = query.isLoading

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

  const pwaAdoptionPct =
    data.tiles.totalPatients > 0
      ? Math.round((data.tiles.pwaEnabled / data.tiles.totalPatients) * 1000) / 10
      : 0
  const pwaActiveRate =
    data.tiles.pwaEnabled > 0
      ? Math.round((data.tiles.pwaActive30d / data.tiles.pwaEnabled) * 1000) / 10
      : 0
  const inactivePct =
    data.tiles.totalPatients > 0
      ? Math.round((data.tiles.inactive12mo / data.tiles.totalPatients) * 1000) / 10
      : 0

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Patient Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Acquisition, lifetime value, demographics, and engagement. Cohort retention lives under
          the Financial tab — open it to see the month-of-first-payment heat map.
        </p>
      </div>

      {/* ── Tiles ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Total patients" value={String(data.tiles.totalPatients)} icon={Users} />
        <Tile
          label="New this month"
          value={String(data.tiles.newThisMonth)}
          icon={CalendarPlus}
          subText="Registered since the 1st"
        />
        <Tile
          label="Active (30 days)"
          value={String(data.tiles.activeLast30d)}
          icon={UserCheck}
          subText="Completed visit in the last 30 days"
        />
        <Tile
          label="Inactive (12+ months)"
          value={String(data.tiles.inactive12mo)}
          icon={UserMinus}
          subText={`${inactivePct}% of patient base`}
          tone={inactivePct > 50 ? 'warning' : 'default'}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="PWA adoption"
          value={`${pwaAdoptionPct}%`}
          icon={Smartphone}
          subText={`${data.tiles.pwaEnabled} of ${data.tiles.totalPatients} enabled`}
        />
        <Tile
          label="PWA active rate"
          value={`${pwaActiveRate}%`}
          icon={Smartphone}
          subText={`${data.tiles.pwaActive30d} of ${data.tiles.pwaEnabled} logged in 30d`}
          tone={pwaActiveRate < 30 && data.tiles.pwaEnabled > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Orthodontic patients"
          value={String(data.tiles.orthoCount)}
          icon={Braces}
          subText={
            data.tiles.totalPatients > 0
              ? `${Math.round((data.tiles.orthoCount / data.tiles.totalPatients) * 1000) / 10}% of base`
              : '—'
          }
        />
        <Tile
          label="Pediatric patients"
          value={String(data.tiles.childCount)}
          icon={Baby}
          subText={
            data.tiles.totalPatients > 0
              ? `${Math.round((data.tiles.childCount / data.tiles.totalPatients) * 1000) / 10}% of base`
              : '—'
          }
        />
      </div>

      {/* ── Acquisition trend ── */}
      <SectionCard
        title="New patient registrations (last 12 months)"
        description="Monthly count of new patient records. Watch the slope: flat or falling needs marketing investigation."
      >
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data.acquisition} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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
              name="New patients"
              stroke="#0ea5e9"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* ── LTV ── */}
      <SectionCard
        title="Patient lifetime value distribution"
        description="Histogram of total paid per patient. The mean is skewed by big-ticket cases; median is the truer middle of the road."
      >
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs mb-3 border-b pb-3">
          <div>
            <span className="text-muted-foreground">Patients paying</span>
            <span className="ml-2 font-semibold">{data.ltv.payerCount}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Median LTV</span>
            <span className="ml-2 font-semibold">{GHS(data.ltv.median)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Mean LTV</span>
            <span className="ml-2 font-semibold">{GHS(data.ltv.mean)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">P90 LTV</span>
            <span className="ml-2 font-semibold">{GHS(data.ltv.p90)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Top 10% revenue share</span>
            <span className="ml-2 font-semibold">{data.ltv.top10ShareOfRevenuePct}%</span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.ltv.histogram} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            <Bar dataKey="count" name="Patients" fill="#10b981" radius={[3, 3, 0, 0]}>
              <LabelList
                dataKey="count"
                position="top"
                style={{ fontSize: 10, fontWeight: 600, fill: '#374151' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* ── Demographics ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Age distribution"
          description={`Patient ages bucketed in 10-year intervals. Average age: ${data.demographics.avgAge} years.`}
        >
          {data.demographics.ageHistogram.every((b) => b.count === 0) ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No date-of-birth data recorded.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={data.demographics.ageHistogram}
                margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                <Bar dataKey="count" name="Patients" fill="#7c3aed" radius={[3, 3, 0, 0]}>
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

        <SectionCard title="Gender mix" description="Patient base by gender.">
          {data.demographics.genderMix.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No data.</p>
          ) : (
            <div className="flex items-center gap-6">
              <div className="w-56 flex-shrink-0">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={data.demographics.genderMix}
                      dataKey="count"
                      nameKey="gender"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {data.demographics.genderMix.map((row) => (
                        <Cell key={row.gender} fill={genderColour(row.gender)} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {data.demographics.genderMix.map((row) => {
                  const total = data.demographics.genderMix.reduce((s, r) => s + r.count, 0)
                  const pct = total > 0 ? Math.round((row.count / total) * 1000) / 10 : 0
                  return (
                    <div key={row.gender} className="flex items-center gap-2 text-sm">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: genderColour(row.gender) }}
                      />
                      <span className="capitalize">{row.gender}</span>
                      <span className="ml-auto tabular-nums font-medium">{row.count}</span>
                      <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                        {pct}%
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Category mix + overlap ── */}
      <SectionCard
        title="Category mix"
        description="Ongoing vs one-time patients, plus the ortho/pediatric overlap. The flags can co-occur — counts won't sum to total."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Category</p>
            {data.mix.category.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data.</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={data.mix.category}
                    dataKey="count"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={75}
                    paddingAngle={2}
                  >
                    {data.mix.category.map((_, i) => (
                      <Cell key={i} fill={CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Flags</p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Orthodontic</span>
                <span className="font-medium tabular-nums">{data.mix.orthoCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pediatric</span>
                <span className="font-medium tabular-nums">{data.mix.childCount}</span>
              </div>
              <div className="flex items-center justify-between border-t pt-2">
                <span className="text-muted-foreground">Both (pediatric ortho)</span>
                <span className="font-medium tabular-nums">{data.mix.orthoChildCount}</span>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ── Inactive list ── */}
      <SectionCard
        title={`Inactive patients — no visit in 12+ months (${data.tiles.inactive12mo} total)`}
        description="Sorted by longest absence first. These are the highest-value re-engagement targets — wire into the CRM later."
      >
        {data.inactiveList.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Everyone has visited in the last 12 months. Healthy patient base.
          </p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="pb-1 text-left font-medium">Patient ID</th>
                  <th className="pb-1 text-left font-medium">Name</th>
                  <th className="pb-1 text-left font-medium">Contact</th>
                  <th className="pb-1 text-right font-medium">Last visit</th>
                  <th className="pb-1 text-right font-medium">Days gone</th>
                </tr>
              </thead>
              <tbody>
                {data.inactiveList.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-1.5 font-mono text-xs">{row.patientId}</td>
                    <td className="py-1.5">{row.name}</td>
                    <td className="py-1.5 text-muted-foreground text-xs truncate max-w-[180px]">
                      {row.phone ?? row.email ?? '—'}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {row.lastVisit ? (
                        new Date(row.lastVisit).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: '2-digit',
                        })
                      ) : (
                        <span className="text-muted-foreground italic">never</span>
                      )}
                    </td>
                    <td
                      className={`py-1.5 text-right tabular-nums font-medium ${
                        row.daysSinceLastVisit === null || row.daysSinceLastVisit > 730
                          ? 'text-red-500'
                          : 'text-amber-600'
                      }`}
                    >
                      {row.daysSinceLastVisit === null ? '—' : row.daysSinceLastVisit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.tiles.inactive12mo > data.inactiveList.length && (
              <p className="text-[11px] text-muted-foreground mt-3">
                Showing {data.inactiveList.length} of {data.tiles.inactive12mo}. Export the full
                list via the Data Inject CSV tab for a re-engagement campaign.
              </p>
            )}
          </>
        )}
      </SectionCard>

      {/* ── Footer note ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          Active = completed visit in last 30 days. Inactive = no completed visit in 12+ months.
        </div>
        <div className="flex items-center gap-2">
          <UserX className="h-4 w-4" />
          Inactive patients with no recorded visit ever are flagged "never" — likely walk-ins.
        </div>
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4" />
          PWA active rate is logins/active in the last 30 days vs total enabled accounts.
        </div>
      </div>
    </div>
  )
}
