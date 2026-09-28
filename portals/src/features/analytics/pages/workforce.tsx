import {
  Award,
  BadgeCheck,
  Building2,
  CalendarClock,
  CalendarOff,
  Clock,
  FileBadge,
  GraduationCap,
  Loader2,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { type ComponentType, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
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
  getWorkforceAnalytics,
  getWorkforceExtended,
  type WorkforceAnalytics,
  type WorkforceExtendedAnalytics,
} from '@/lib/actions/analytics'
import { useApiQuery } from '@/lib/query'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { formatAmount } from '@/shared/utils/currency'

const WORKFORCE_KEY = (period: string) => ['analytics', 'workforce', period] as const
const WORKFORCE_EXTENDED_KEY = (period: string) =>
  ['analytics', 'workforce', 'extended', period] as const

const GHS = (n: number) => `GHS ${formatAmount(n)}`

const GHS_COMPACT = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `GHS ${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `GHS ${(n / 1_000).toFixed(1)}K`
  return GHS(n)
}

const SHORT_DAY = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

const SHORT_MONTH = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })

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

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      Loading…
    </div>
  )
}

// ── Action list row ──────────────────────────────────────────────────────────

function dayLeftTone(days: number | null): 'default' | 'warning' | 'danger' {
  if (days === null) return 'default'
  if (days < 14) return 'danger'
  if (days < 30) return 'warning'
  return 'default'
}

function dayLeftColour(days: number | null): string {
  const t = dayLeftTone(days)
  if (t === 'danger') return 'text-red-500'
  if (t === 'warning') return 'text-amber-600'
  return 'text-muted-foreground'
}

// ─────────────────────────────────────────────────────────────────────────────

type TabId = 'headcount' | 'attendance' | 'payroll' | 'training' | 'leave-compliance'
const VALID_TABS: TabId[] = ['headcount', 'attendance', 'payroll', 'training', 'leave-compliance']
function isTabId(v: string | null): v is TabId {
  return v !== null && (VALID_TABS as string[]).includes(v)
}

export default function WorkforceAnalyticsPage({ printMode = false }: { printMode?: boolean }) {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(WORKFORCE_KEY(periodQuery), () => getWorkforceAnalytics(periodQuery))
  const data = query.data ?? null
  const error = query.error ? query.error.message : null
  const loading = query.isLoading
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab: TabId = isTabId(searchParams.get('tab'))
    ? (searchParams.get('tab') as TabId)
    : 'headcount'

  function setTab(t: TabId) {
    const next = new URLSearchParams(searchParams)
    if (t === 'headcount') next.delete('tab')
    else next.set('tab', t)
    setSearchParams(next, { replace: true })
  }

  if (printMode) {
    return (
      <div className="flex flex-col gap-8 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workforce Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Headcount, attendance, payroll, and training in one place.
          </p>
        </div>
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold border-b pb-1">Headcount</h2>
          {loading || !data ? <PageLoader /> : <HeadcountTab data={data.headcount} />}
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold border-b pb-1">Attendance</h2>
          {loading || !data ? <PageLoader /> : <AttendanceTab data={data.attendance} />}
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold border-b pb-1">Payroll</h2>
          {loading || !data ? <PageLoader /> : <PayrollTab data={data.payroll} />}
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold border-b pb-1">Training &amp; Performance</h2>
          {loading || !data ? <PageLoader /> : <TrainingTab data={data.training} />}
        </section>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Workforce Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          HR's view of the clinic. Headcount, attendance, payroll, and training in one place.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabId)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="headcount">Headcount</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="payroll">Payroll</TabsTrigger>
          <TabsTrigger value="training">Training &amp; Performance</TabsTrigger>
          <TabsTrigger value="leave-compliance">Leave &amp; Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="headcount" className="space-y-4">
          {loading || !data ? <PageLoader /> : <HeadcountTab data={data.headcount} />}
        </TabsContent>
        <TabsContent value="attendance" className="space-y-4">
          {loading || !data ? <PageLoader /> : <AttendanceTab data={data.attendance} />}
        </TabsContent>
        <TabsContent value="payroll" className="space-y-4">
          {loading || !data ? <PageLoader /> : <PayrollTab data={data.payroll} />}
        </TabsContent>
        <TabsContent value="training" className="space-y-4">
          {loading || !data ? <PageLoader /> : <TrainingTab data={data.training} />}
        </TabsContent>
        <TabsContent value="leave-compliance" className="space-y-4">
          <LeaveComplianceTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Leave & Compliance (Phase 2C) ──────────────────────────────────────────

function LeaveComplianceTab() {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(WORKFORCE_EXTENDED_KEY(periodQuery), () =>
    getWorkforceExtended(periodQuery)
  )
  const data = query.data ?? null
  const loading = query.isLoading
  const error = query.error ? query.error.message : null

  if (loading || !data) return <PageLoader />
  if (error)
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </p>
    )

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Leave utilisation"
          value={`${data.tiles.overallLeaveUtilPct}%`}
          icon={Users}
          subText={`${data.tiles.totalLeaveTaken} / ${data.tiles.totalEntitlementDays} days`}
        />
        <Tile
          label="Pending leave requests"
          value={String(data.tiles.pendingLeaveRequests)}
          icon={Users}
          tone={data.tiles.pendingLeaveRequests > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Credentials expiring (90d)"
          value={String(
            data.tiles.credExpires30 + data.tiles.credExpires60 + data.tiles.credExpires90
          )}
          icon={ShieldAlert}
          subText={`${data.tiles.credExpired} already expired`}
          tone={
            data.tiles.credExpired > 0
              ? 'danger'
              : data.tiles.credExpires30 > 0
                ? 'warning'
                : 'default'
          }
        />
        <Tile
          label="Review coverage"
          value={`${data.tiles.reviewCoveragePct}%`}
          icon={Users}
          subText={`${data.tiles.staffMissingReview} missing`}
          tone={data.tiles.reviewCoveragePct < 70 ? 'warning' : 'success'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Leave balance — top consumers"
          description="Annual entitlement vs. days approved this period."
        >
          {data.leaveBalance.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No leave records in window.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-1">Staff</th>
                  <th className="text-right font-medium pb-1">Entitled</th>
                  <th className="text-right font-medium pb-1">Taken</th>
                  <th className="text-right font-medium pb-1">Remaining</th>
                  <th className="text-right font-medium pb-1">Use %</th>
                </tr>
              </thead>
              <tbody>
                {data.leaveBalance.slice(0, 15).map((s) => (
                  <tr key={s.staffId} className="border-t">
                    <td className="py-1.5">{s.fullName}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.entitlement}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.taken}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.remaining}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">
                      {s.utilisationPct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard title="Credentials rolling forward" description="Most urgent first.">
          {data.credentialsRollingForward.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No credential expiries in the next 90 days.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-1">Credential</th>
                  <th className="text-left font-medium pb-1">Type</th>
                  <th className="text-right font-medium pb-1">Days left</th>
                  <th className="text-right font-medium pb-1">Bucket</th>
                </tr>
              </thead>
              <tbody>
                {data.credentialsRollingForward.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="py-1.5">{c.credentialName ?? '—'}</td>
                    <td className="py-1.5 text-muted-foreground">{c.credentialType ?? '—'}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.daysLeft}</td>
                    <td className="py-1.5 text-right">
                      <span
                        className={
                          c.bucket === 'expired'
                            ? 'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700'
                            : c.bucket === '30'
                              ? 'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700'
                              : 'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground'
                        }
                      >
                        {c.bucket === 'expired' ? 'expired' : `≤${c.bucket}d`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <SectionCard title="Mandatory training deadlines">
          {data.trainingDeadlines.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No mandatory training with deadlines configured.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-1">Material</th>
                  <th className="text-right font-medium pb-1">Days left</th>
                  <th className="text-right font-medium pb-1">Completion</th>
                </tr>
              </thead>
              <tbody>
                {data.trainingDeadlines.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="py-1.5">{t.title}</td>
                    <td className="py-1.5 text-right tabular-nums">{t.daysLeft ?? '—'}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">
                      {t.completionPct}% ({t.completedCount}/{t.assignedCount})
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

// ─── Headcount tab ───────────────────────────────────────────────────────────

function HeadcountTab({ data }: { data: WorkforceAnalytics['headcount'] }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Active staff" value={String(data.tiles.total)} icon={Users} />
        <Tile
          label="New hires (12mo)"
          value={String(data.tiles.newHires12mo)}
          icon={UserPlus}
          tone="success"
        />
        <Tile
          label="Leavers (12mo)"
          value={String(data.tiles.leavers12mo)}
          icon={UserMinus}
          subText={`Turnover ${data.tiles.turnoverPct}%`}
          tone={
            data.tiles.turnoverPct > 20
              ? 'danger'
              : data.tiles.turnoverPct > 10
                ? 'warning'
                : 'default'
          }
        />
        <Tile
          label="Action items"
          value={String(
            data.tiles.probationCount +
              data.tiles.contractEndingCount +
              data.tiles.credentialsExpiringCount
          )}
          icon={ShieldAlert}
          subText="Within 90 days"
          tone={data.tiles.credentialsExpiringCount > 0 ? 'warning' : 'default'}
        />
      </div>

      <SectionCard
        title="Tenure distribution"
        description="How long current staff have been with the clinic."
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.tenureHistogram} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            <Bar dataKey="count" name="Staff" fill="#7c3aed" radius={[3, 3, 0, 0]}>
              <LabelList
                dataKey="count"
                position="top"
                style={{ fontSize: 10, fontWeight: 600, fill: '#374151' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard
        title="Position breakdown"
        description="Active staff grouped by job title. Top 15."
      >
        {data.byPosition.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No data.</p>
        ) : (
          <ResponsiveContainer
            width="100%"
            height={Math.max(180, Math.min(data.byPosition.length, 15) * 30)}
          >
            <BarChart
              layout="vertical"
              data={data.byPosition.slice(0, 15)}
              margin={{ top: 0, right: 40, left: 32, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis dataKey="position" type="category" tick={{ fontSize: 11 }} width={150} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Bar dataKey="count" name="Staff" fill="#10b981" radius={[0, 3, 3, 0]}>
                <LabelList
                  dataKey="count"
                  position="right"
                  style={{ fontSize: 11, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SectionCard
          title="Probation ending"
          description={`${data.probationEnding.length} within 90 days`}
        >
          {data.probationEnding.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">None upcoming.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.probationEnding.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between py-1 border-b border-border last:border-0"
                >
                  <span className="truncate pr-2" title={row.fullName}>
                    {row.fullName}
                  </span>
                  <span
                    className={`text-xs tabular-nums font-medium ${dayLeftColour(row.daysLeft)}`}
                  >
                    {row.daysLeft === null ? '—' : `${row.daysLeft}d`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Contracts ending"
          description={`${data.contractEnding.length} within 90 days`}
        >
          {data.contractEnding.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">None upcoming.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.contractEnding.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between py-1 border-b border-border last:border-0"
                >
                  <span className="truncate pr-2" title={row.fullName}>
                    {row.fullName}
                  </span>
                  <span
                    className={`text-xs tabular-nums font-medium ${dayLeftColour(row.daysLeft)}`}
                  >
                    {row.daysLeft === null ? '—' : `${row.daysLeft}d`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Credentials expiring"
          description={`${data.credentialsExpiring.length} within 90 days`}
        >
          {data.credentialsExpiring.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              All credentials current.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.credentialsExpiring.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between py-1 border-b border-border last:border-0"
                >
                  <span
                    className="truncate pr-2"
                    title={row.credentialName ?? row.credentialType ?? ''}
                  >
                    {row.credentialName ?? row.credentialType ?? '—'}
                  </span>
                  <span
                    className={`text-xs tabular-nums font-medium ${dayLeftColour(row.daysLeft)}`}
                  >
                    {row.daysLeft === null ? '—' : `${row.daysLeft}d`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </>
  )
}

// ─── Attendance tab ──────────────────────────────────────────────────────────

function AttendanceTab({ data }: { data: WorkforceAnalytics['attendance'] }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Attendance rate (30d)"
          value={`${data.tiles.attendanceRate}%`}
          icon={BadgeCheck}
          subText="Present or late / total records"
          tone={
            data.tiles.attendanceRate < 85
              ? 'warning'
              : data.tiles.attendanceRate < 75
                ? 'danger'
                : 'success'
          }
        />
        <Tile
          label="Lateness rate"
          value={`${data.tiles.latenessRate}%`}
          icon={Clock}
          subText={`${data.tiles.late} late of ${data.tiles.totalRecords}`}
          tone={data.tiles.latenessRate > 10 ? 'warning' : 'default'}
        />
        <Tile
          label="Absences"
          value={String(data.tiles.absent)}
          icon={CalendarOff}
          subText="Unauthorised + unaccounted"
          tone={data.tiles.absent > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Records on file"
          value={String(data.tiles.totalRecords)}
          icon={CalendarClock}
          subText="Last 30 days"
        />
      </div>

      <SectionCard
        title="Daily attendance (last 30 days)"
        description="Stacked counts per day. Lateness shown separately so the trend is visible."
      >
        {data.tiles.totalRecords === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No attendance records in the last 30 days.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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
                labelFormatter={(l) => SHORT_DAY(l as string)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
              <Bar dataKey="present" name="Present" stackId="a" fill="#10b981" />
              <Bar dataKey="late" name="Late" stackId="a" fill="#f59e0b" />
              <Bar dataKey="halfDay" name="Half day" stackId="a" fill="#06b6d4" />
              <Bar dataKey="leave" name="Leave" stackId="a" fill="#8b5cf6" />
              <Bar dataKey="absent" name="Absent" stackId="a" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </SectionCard>
    </>
  )
}

// ─── Payroll tab ─────────────────────────────────────────────────────────────

function PayrollTab({ data }: { data: WorkforceAnalytics['payroll'] }) {
  const monthlyDelta =
    data.trend.length >= 2
      ? data.trend[data.trend.length - 1].totalNet - data.trend[data.trend.length - 2].totalNet
      : 0
  const monthlyDeltaPct =
    data.trend.length >= 2 && data.trend[data.trend.length - 2].totalNet > 0
      ? Math.round((monthlyDelta / data.trend[data.trend.length - 2].totalNet) * 1000) / 10
      : 0

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Latest payroll (net)"
          value={GHS_COMPACT(data.tiles.latestNet)}
          icon={Wallet}
          subText={
            data.trend.length >= 2
              ? `${monthlyDelta >= 0 ? '+' : ''}${monthlyDeltaPct}% vs prior period`
              : 'Single period'
          }
        />
        <Tile
          label="Latest gross"
          value={GHS_COMPACT(data.tiles.latestGross)}
          icon={Wallet}
          subText={`Gross-to-net: ${data.tiles.grossToNetRatio}%`}
        />
        <Tile
          label="YTD net payroll"
          value={GHS_COMPACT(data.tiles.totalNetYtd)}
          icon={TrendingUp}
        />
        <Tile
          label="Periods on file"
          value={String(data.tiles.runCount)}
          icon={FileBadge}
          subText="Published or locked (12mo)"
        />
      </div>

      <SectionCard
        title="Monthly payroll (last 12 months)"
        description="Net pay per published period. The gross line shows tax burden — gap = PAYE + SSNIT + other deductions."
      >
        {data.trend.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No published payroll runs in the last 12 months.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="payPeriodEnd" tick={{ fontSize: 10 }} tickFormatter={SHORT_MONTH} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => GHS_COMPACT(v as number)} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
                labelFormatter={(l) => SHORT_MONTH(l as string)}
                formatter={(v) => [GHS(v as number), '']}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
              <Line
                type="monotone"
                dataKey="totalGross"
                name="Gross"
                stroke="#94a3b8"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="totalNet"
                name="Net"
                stroke="#0ea5e9"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="totalPaye"
                name="PAYE"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="totalSsnit"
                name="SSNIT"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      <SectionCard
        title="Payroll history (table)"
        description="Sorted oldest → newest. Use the data-inject CSV path to export."
      >
        {data.trend.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No payroll history.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-1 text-left font-medium">Period</th>
                <th className="pb-1 text-right font-medium">Staff</th>
                <th className="pb-1 text-right font-medium">Gross</th>
                <th className="pb-1 text-right font-medium">Net</th>
                <th className="pb-1 text-right font-medium">PAYE</th>
                <th className="pb-1 text-right font-medium">SSNIT</th>
              </tr>
            </thead>
            <tbody>
              {data.trend
                .slice()
                .reverse()
                .slice(0, 12)
                .map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-1.5">{r.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.staffCount}</td>
                    <td className="py-1.5 text-right tabular-nums">{GHS(r.totalGross)}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">
                      {GHS(r.totalNet)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {GHS(r.totalPaye)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {GHS(r.totalSsnit)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </>
  )
}

// ─── Training & Performance tab ──────────────────────────────────────────────

function TrainingTab({ data }: { data: WorkforceAnalytics['training'] }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Total materials"
          value={String(data.tiles.totalMaterials)}
          icon={GraduationCap}
        />
        <Tile
          label="Mandatory compliance"
          value={`${data.tiles.mandatoryComplianceRate}%`}
          icon={ShieldAlert}
          subText={`${data.tiles.mandatoryMaterials} mandatory material${data.tiles.mandatoryMaterials === 1 ? '' : 's'}`}
          tone={
            data.tiles.mandatoryComplianceRate < 80 && data.tiles.mandatoryMaterials > 0
              ? 'danger'
              : data.tiles.mandatoryComplianceRate < 95 && data.tiles.mandatoryMaterials > 0
                ? 'warning'
                : 'default'
          }
        />
        <Tile
          label="Avg performance score"
          value={data.tiles.perfRecords === 0 ? '—' : `${data.tiles.avgPerformance} / 5`}
          icon={Award}
          subText={`${data.tiles.perfRecords} review${data.tiles.perfRecords === 1 ? '' : 's'} in 12mo`}
          tone={
            data.tiles.perfRecords > 0 && data.tiles.avgPerformance >= 4
              ? 'success'
              : data.tiles.perfRecords > 0 && data.tiles.avgPerformance < 3
                ? 'warning'
                : 'default'
          }
        />
        <Tile
          label="At-risk trainings"
          value={String(
            data.materials.filter((m) => m.completionRate < 50 && m.assigned > 0).length
          )}
          icon={TrendingDown}
          subText="< 50% completion"
          tone={
            data.materials.filter((m) => m.isMandatory && m.completionRate < 80 && m.assigned > 0)
              .length > 0
              ? 'warning'
              : 'default'
          }
        />
      </div>

      <SectionCard
        title="Training completion"
        description="Mandatory rows float to the top, then sorted by lowest completion rate. Acts as a remediation list."
      >
        {data.materials.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No training materials uploaded yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-1 text-left font-medium">Title</th>
                <th className="pb-1 text-center font-medium">Type</th>
                <th className="pb-1 text-right font-medium">Assigned</th>
                <th className="pb-1 text-right font-medium">Completed</th>
                <th className="pb-1 text-right font-medium">Rate</th>
                <th className="pb-1 text-right font-medium">Avg score</th>
              </tr>
            </thead>
            <tbody>
              {data.materials.slice(0, 25).map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="py-1.5 truncate max-w-[260px]" title={m.title}>
                    {m.title}
                  </td>
                  <td className="py-1.5 text-center">
                    {m.isMandatory ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
                        Mandatory
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground border border-border">
                        Optional
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{m.assigned}</td>
                  <td className="py-1.5 text-right tabular-nums">{m.completed}</td>
                  <td
                    className={`py-1.5 text-right tabular-nums font-medium ${
                      m.assigned === 0
                        ? 'text-muted-foreground'
                        : m.completionRate >= 90
                          ? 'text-emerald-600'
                          : m.completionRate >= 60
                            ? 'text-amber-600'
                            : 'text-red-500'
                    }`}
                  >
                    {m.assigned === 0 ? '—' : `${m.completionRate}%`}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {m.avgScore === null ? '—' : m.avgScore}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.materials.length > 25 && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Showing 25 of {data.materials.length}. Full table available via export.
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Performance score distribution"
        description={`Scores from the last 12 months across all evaluation categories. Average: ${data.tiles.avgPerformance} / 5.`}
      >
        {data.tiles.perfRecords === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No performance evaluations on file in the last 12 months.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={data.performanceHistogram}
              margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Bar dataKey="count" name="Evaluations" fill="#a855f7" radius={[3, 3, 0, 0]}>
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

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          For deep HR drill-downs, open the Staff module.
        </div>
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          Action items (probation, contracts, credentials) are on the Headcount tab.
        </div>
      </div>
    </>
  )
}
