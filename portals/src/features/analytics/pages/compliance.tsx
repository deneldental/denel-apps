import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Calendar,
  FileText,
  FileWarning,
  KeyRound,
  Loader2,
  Lock,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Siren,
  TrendingUp,
} from 'lucide-react'
import { type ComponentType, useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  type DotItemDotProps,
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
  type ComplianceAnalytics,
  getComplianceAnalytics,
} from '@/lib/actions/analytics'
import { useApiQuery } from '@/lib/query'

const COMPLIANCE_KEY = (period: string) => ['analytics', 'compliance', period] as const

const SHORT_DAY = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const SHORT_DATE = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })

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

function daysLeftColour(days: number, expired = false): string {
  if (expired) return 'text-red-500'
  if (days < 14) return 'text-red-500'
  if (days < 30) return 'text-amber-600'
  return 'text-muted-foreground'
}

const MODULE_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#94a3b8']

// ─────────────────────────────────────────────────────────────────────────────

export default function ComplianceAnalyticsPage() {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(COMPLIANCE_KEY(periodQuery), () => getComplianceAnalytics(periodQuery))
  const data = query.data ?? null
  const error = query.error ? query.error.message : null
  const loading = query.isLoading

  // Failed login spike detector: any day with > mean + 2 stddev is flagged on
  // the chart. Falls back to a simple threshold (>10 failed) when sample size
  // is too small for stddev to be meaningful.
  const failureSpikeThreshold = useMemo(() => {
    if (!data) return Infinity
    const vals = data.loginTrend.map((d) => d.failed)
    const n = vals.length
    if (n < 7) return 10
    const mean = vals.reduce((s, v) => s + v, 0) / n
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n
    const stddev = Math.sqrt(variance)
    return Math.max(5, mean + 2 * stddev)
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

  const allClear =
    data.tiles.credentialsExpired === 0 &&
    data.tiles.credentialsSuspended === 0 &&
    data.tiles.complianceDocsExpired === 0 &&
    data.tiles.credentialsExpiring30d === 0

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Compliance &amp; Risk</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Expiring credentials and docs, system activity at scale, and security signals worth
          watching. Three lenses on one page so the admin can triage in under a minute.
        </p>
      </div>

      {/* ── Banner: all clear or attention needed ── */}
      {allClear ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold text-emerald-900">All clear</p>
            <p className="text-emerald-800 mt-0.5">
              No expired credentials, suspended staff, expired compliance docs, or credentials
              expiring in the next 30 days. Keep an eye on the upcoming-90d list below.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900">Items needing attention</p>
            <ul className="mt-1 text-amber-800 list-disc list-inside space-y-0.5">
              {data.tiles.credentialsExpired > 0 && (
                <li>
                  {data.tiles.credentialsExpired} credential
                  {data.tiles.credentialsExpired === 1 ? '' : 's'} already lapsed
                </li>
              )}
              {data.tiles.credentialsSuspended > 0 && (
                <li>{data.tiles.credentialsSuspended} staff suspended due to credential lapse</li>
              )}
              {data.tiles.credentialsExpiring30d > 0 && (
                <li>
                  {data.tiles.credentialsExpiring30d} credential
                  {data.tiles.credentialsExpiring30d === 1 ? '' : 's'} expiring within 30 days
                </li>
              )}
              {data.tiles.complianceDocsExpired > 0 && (
                <li>
                  {data.tiles.complianceDocsExpired} clinic compliance document
                  {data.tiles.complianceDocsExpired === 1 ? '' : 's'} past expiry
                </li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* ── Tile row 1 — credentials & documents ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Credentials expired"
          value={String(data.tiles.credentialsExpired)}
          icon={ShieldX}
          subText="Already past expiry"
          tone={data.tiles.credentialsExpired > 0 ? 'danger' : 'success'}
        />
        <Tile
          label="Expiring < 30 days"
          value={String(data.tiles.credentialsExpiring30d)}
          icon={ShieldAlert}
          subText={`${data.tiles.credentialsExpiring90d} expiring within 90d total`}
          tone={data.tiles.credentialsExpiring30d > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Suspended (lapse)"
          value={String(data.tiles.credentialsSuspended)}
          icon={Lock}
          subText="Staff blocked from clinical work"
          tone={data.tiles.credentialsSuspended > 0 ? 'danger' : 'default'}
        />
        <Tile
          label="Compliance docs"
          value={String(data.tiles.complianceDocsExpired + data.tiles.complianceDocsExpiring90d)}
          icon={FileWarning}
          subText={
            data.tiles.complianceDocsExpired > 0
              ? `${data.tiles.complianceDocsExpired} expired · ${data.tiles.complianceDocsExpiring90d} expiring`
              : `${data.tiles.complianceDocsExpiring90d} expiring in 90d`
          }
          tone={
            data.tiles.complianceDocsExpired > 0
              ? 'danger'
              : data.tiles.complianceDocsExpiring90d > 0
                ? 'warning'
                : 'default'
          }
        />
      </div>

      {/* ── Tile row 2 — activity & security ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Audit events (24h)"
          value={String(data.tiles.auditEvents24h)}
          icon={Activity}
          subText="Recorded changes across all modules"
        />
        <Tile
          label="Failed logins (24h)"
          value={String(data.tiles.failedLogins24h)}
          icon={KeyRound}
          subText={`${data.tiles.failedLogins30d} in last 30 days`}
          tone={
            data.tiles.failedLogins24h > 50
              ? 'danger'
              : data.tiles.failedLogins24h > 20
                ? 'warning'
                : 'default'
          }
        />
        <Tile
          label="Sync errors (7d)"
          value={String(data.tiles.syncErrors7d)}
          icon={AlertOctagon}
          subText="Failed reporting-DB pushes"
          tone={data.tiles.syncErrors7d > 0 ? 'warning' : 'success'}
        />
        <Tile
          label="Staff docs expiring"
          value={String(data.tiles.staffDocsExpiring90d)}
          icon={FileText}
          subText="Within 90 days"
          tone={data.tiles.staffDocsExpiring90d > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* ── Audit log volume + login trend ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Audit log volume (30 days)"
          description="Daily change activity stacked by module. Top 5 modules get their own series; everything else stacks into 'other'."
        >
          {data.tiles.auditEvents24h === 0 &&
          data.auditTrend.every(
            (d) =>
              Object.entries(d)
                .filter(([k]) => k !== 'day')
                .reduce((s, [, v]) => s + Number(v), 0) === 0
          ) ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No audit activity yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.auditTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => SHORT_DAY(v as string)}
                  minTickGap={20}
                />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  labelFormatter={(l) => SHORT_DAY(l as string)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
                {data.auditModules.map((mod, i) => (
                  <Area
                    key={mod}
                    type="monotone"
                    stackId="audit"
                    dataKey={mod}
                    name={mod}
                    stroke={MODULE_COLORS[i % MODULE_COLORS.length]}
                    fill={MODULE_COLORS[i % MODULE_COLORS.length]}
                    fillOpacity={0.6}
                  />
                ))}
                <Area
                  type="monotone"
                  stackId="audit"
                  dataKey="other"
                  name="Other"
                  stroke={MODULE_COLORS[5]}
                  fill={MODULE_COLORS[5]}
                  fillOpacity={0.6}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard
          title="Login attempts (30 days)"
          description={`Daily success vs failure. Spike threshold for failures: ${Math.round(failureSpikeThreshold)}+ per day.`}
        >
          {data.loginTrend.every((d) => d.failed + d.success === 0) ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No login attempts logged in the last 30 days.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart
                data={data.loginTrend}
                margin={{ top: 8, right: 16, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => SHORT_DAY(v as string)}
                  minTickGap={20}
                />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  labelFormatter={(l) => SHORT_DAY(l as string)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
                <Line
                  type="monotone"
                  dataKey="success"
                  name="Success"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="failed"
                  name="Failed"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={(props: DotItemDotProps) => {
                    const row = props.payload as ComplianceAnalytics['loginTrend'][number]
                    const isSpike = row.failed >= failureSpikeThreshold
                    return (
                      <circle
                        key={`${props.cx}-${props.cy}`}
                        cx={props.cx}
                        cy={props.cy}
                        r={isSpike ? 5 : 3}
                        fill="#ef4444"
                        stroke={isSpike ? '#7f1d1d' : 'none'}
                        strokeWidth={2}
                      />
                    )
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      {/* ── Expiring credentials list + Expiring compliance docs list ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Credentials expiring (next 90 days)"
          description="Sorted soonest first. Red ≤14 days, amber ≤30 days, muted otherwise."
        >
          {data.credentialsExpiring.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Nothing expiring in the next 90 days.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.credentialsExpiring.slice(0, 20).map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 py-1 border-b border-border last:border-0 text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <p
                      className="font-medium truncate"
                      title={c.credentialName ?? c.credentialType ?? ''}
                    >
                      {c.credentialName ?? c.credentialType ?? '—'}
                    </p>
                    {c.credentialType && c.credentialName && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        {c.credentialType}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums hidden md:inline">
                    {SHORT_DATE(c.expiryDate)}
                  </span>
                  <span
                    className={`text-xs tabular-nums font-medium w-14 text-right ${daysLeftColour(c.daysLeft)}`}
                  >
                    {c.daysLeft}d
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.credentialsExpiring.length > 20 && (
            <p className="text-[11px] text-muted-foreground mt-2">
              Showing 20 of {data.credentialsExpiring.length}.
            </p>
          )}
        </SectionCard>

        <SectionCard
          title="Compliance documents (next 90 days)"
          description="Clinic-wide documents: health, fire, finance, data. Past-due rows would show in red."
        >
          {data.complianceDocsExpiring.length === 0 && data.tiles.complianceDocsExpired === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              All compliance documents current.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.complianceDocsExpiring.slice(0, 20).map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-2 py-1 border-b border-border last:border-0 text-sm"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate" title={d.documentName}>
                      {d.documentName}
                    </p>
                    <p className="text-[11px] text-muted-foreground capitalize truncate">
                      {d.category}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums hidden md:inline">
                    {SHORT_DATE(d.dateExpired)}
                  </span>
                  <span
                    className={`text-xs tabular-nums font-medium w-14 text-right ${daysLeftColour(d.daysLeft)}`}
                  >
                    {d.daysLeft}d
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.tiles.complianceDocsExpired > 0 && (
            <p className="text-[11px] text-red-500 mt-2">
              {data.tiles.complianceDocsExpired} document
              {data.tiles.complianceDocsExpired === 1 ? '' : 's'} already past expiry — open the
              Compliance module to remediate.
            </p>
          )}
        </SectionCard>
      </div>

      {/* ── Expired credentials list (action-needed) ── */}
      {data.credentialsExpired.length > 0 && (
        <SectionCard
          title="Already expired credentials"
          description="Past-expiry credentials still on file. Re-verify or remove. Sorted by most-recently expired first."
        >
          <ul className="space-y-1.5">
            {data.credentialsExpired.slice(0, 15).map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-2 py-1 border-b border-border last:border-0 text-sm"
              >
                <Siren className="h-3.5 w-3.5 text-red-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p
                    className="font-medium truncate"
                    title={c.credentialName ?? c.credentialType ?? ''}
                  >
                    {c.credentialName ?? c.credentialType ?? '—'}
                  </p>
                  {c.credentialType && c.credentialName && (
                    <p className="text-[11px] text-muted-foreground truncate">{c.credentialType}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground tabular-nums hidden md:inline">
                  Expired {SHORT_DATE(c.expiryDate)}
                </span>
                <span className="text-xs tabular-nums font-medium text-red-500 w-20 text-right">
                  {c.daysAgo}d ago
                </span>
              </li>
            ))}
          </ul>
          {data.credentialsExpired.length > 15 && (
            <p className="text-[11px] text-muted-foreground mt-2">
              Showing 15 of {data.credentialsExpired.length}.
            </p>
          )}
        </SectionCard>
      )}

      {/* ── Top audited entities + module activity ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Activity by module (30d)"
          description="Which modules see the most changes. Outliers (one module dominating) are usually fine; sudden inversions aren't."
        >
          {data.moduleTotals.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No audit activity yet.</p>
          ) : (
            <ResponsiveContainer
              width="100%"
              height={Math.max(180, Math.min(data.moduleTotals.length, 12) * 28)}
            >
              <BarChart
                layout="vertical"
                data={data.moduleTotals.slice(0, 12)}
                margin={{ top: 0, right: 40, left: 24, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis dataKey="module" type="category" tick={{ fontSize: 11 }} width={130} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                <Bar dataKey="count" name="Events" fill="#0ea5e9" radius={[0, 3, 3, 0]}>
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

        <SectionCard
          title="Top changed entities (30d)"
          description="Records taking the most edits. A few hot rows is normal; one entity hammered hundreds of times warrants a look."
        >
          {data.topEntities.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No audited entities in the window.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="pb-1 text-left font-medium">Entity</th>
                  <th className="pb-1 text-left font-medium">Module</th>
                  <th className="pb-1 text-right font-medium">Changes</th>
                </tr>
              </thead>
              <tbody>
                {data.topEntities.slice(0, 12).map((row, i) => (
                  <tr key={`${row.module}_${row.entityId}_${i}`} className="border-b last:border-0">
                    <td
                      className="py-1.5 truncate max-w-[280px]"
                      title={row.entityName ?? row.entityId ?? ''}
                    >
                      {row.entityName ?? row.entityId ?? '—'}
                    </td>
                    <td className="py-1.5 text-muted-foreground text-xs capitalize">
                      {row.module}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-medium">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      {/* ── Sync errors + Soft-delete activity ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Recent sync errors (7d)"
          description="Failed pushes to the reporting database. Each row is the last error message for the failing entity."
        >
          {data.syncErrors.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No sync errors in the last 7 days.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.syncErrors.slice(0, 12).map((e) => (
                <li key={e.id} className="py-1.5 border-b border-border last:border-0">
                  <div className="flex items-center gap-2 text-sm">
                    <AlertOctagon className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <span className="font-medium truncate">{e.entityType}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(e.syncedAt).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {e.errorMessage && (
                    <p
                      className="text-[11px] text-muted-foreground mt-0.5 ml-5 truncate"
                      title={e.errorMessage}
                    >
                      {e.errorMessage}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Soft-delete activity (30d)"
          description="Where rows are being deleted. A clinical workflow might delete dozens daily; a module with no usual deletes spiking should raise eyebrows."
        >
          {data.softDeleteByModule.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No deletes recorded in the window.
            </p>
          ) : (
            <ResponsiveContainer
              width="100%"
              height={Math.max(180, Math.min(data.softDeleteByModule.length, 10) * 28)}
            >
              <BarChart
                layout="vertical"
                data={data.softDeleteByModule.slice(0, 10)}
                margin={{ top: 0, right: 40, left: 24, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis dataKey="module" type="category" tick={{ fontSize: 11 }} width={130} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                <Bar dataKey="count" name="Deletes" fill="#f97316" radius={[0, 3, 3, 0]}>
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
      </div>

      {/* ── Footer note ── */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4" />
          For full audit log drill-down with diffs, open the Audit Logs module.
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Expiry windows: red ≤14 days, amber ≤30 days, muted ≤90 days.
        </div>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Login spike threshold = mean + 2σ over the rolling 30-day window.
        </div>
      </div>
    </div>
  )
}
