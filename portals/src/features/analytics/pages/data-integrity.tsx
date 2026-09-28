import {
  AlertOctagon,
  Boxes,
  CheckCircle2,
  Database,
  type LucideIcon,
  ShieldAlert,
  ToggleRight,
  TrendingUp,
} from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
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
import { useAnalyticsPeriod } from '@/features/analytics/period-context'
import {
  buildPeriodQuery,
  type DataIntegrityAnalytics,
  getDataIntegrityAnalytics,
} from '@/lib/actions/analytics'
import { useApiQuery } from '@/lib/query'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'

const DATA_INTEGRITY_KEY = (period: string) => ['analytics', 'data-integrity', period] as const

interface TileProps {
  label: string
  value: string
  icon: LucideIcon
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

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  )
}

function PageLoader() {
  return <div className="h-72 rounded-xl border bg-muted/30 animate-pulse" />
}

const TAB_IDS = ['sync', 'inject', 'completeness', 'audit'] as const
type TabId = (typeof TAB_IDS)[number]

export default function DataIntegrityPage({ printMode = false }: { printMode?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') as TabId | null
  const activeTab: TabId = TAB_IDS.includes(tabParam as TabId) ? (tabParam as TabId) : 'sync'

  function setTab(t: TabId) {
    const next = new URLSearchParams(searchParams)
    if (t === 'sync') next.delete('tab')
    else next.set('tab', t)
    setSearchParams(next, { replace: true })
  }

  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(DATA_INTEGRITY_KEY(periodQuery), () =>
    getDataIntegrityAnalytics(periodQuery)
  )
  const data = query.data ?? null
  const loading = query.isLoading
  const error = query.error ? query.error.message : null

  if (printMode) {
    return (
      <div className="flex flex-col gap-8 p-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Data Integrity</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sync health, data-inject volume, completeness, and toggle audit trail.
          </p>
        </header>
        {loading || !data ? (
          <PageLoader />
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold border-b pb-1">Sync health</h2>
              <SyncSection data={data} />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold border-b pb-1">Data inject</h2>
              <InjectSection data={data} />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold border-b pb-1">Completeness</h2>
              <CompletenessSection data={data} />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold border-b pb-1">Toggle audit trail</h2>
              <AuditSection data={data} />
            </section>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Data Integrity</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Records injected, sync success rate, completeness scorecards, and reports-injection
          governance.
        </p>
      </header>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabId)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="sync">Sync</TabsTrigger>
          <TabsTrigger value="inject">Data inject</TabsTrigger>
          <TabsTrigger value="completeness">Completeness</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="sync" className="space-y-4">
          {loading || !data ? <PageLoader /> : <SyncSection data={data} />}
        </TabsContent>
        <TabsContent value="inject" className="space-y-4">
          {loading || !data ? <PageLoader /> : <InjectSection data={data} />}
        </TabsContent>
        <TabsContent value="completeness" className="space-y-4">
          {loading || !data ? <PageLoader /> : <CompletenessSection data={data} />}
        </TabsContent>
        <TabsContent value="audit" className="space-y-4">
          {loading || !data ? <PageLoader /> : <AuditSection data={data} />}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SyncSection({ data }: { data: DataIntegrityAnalytics }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Sync success rate"
          value={`${data.tiles.syncSuccessRatePct}%`}
          icon={CheckCircle2}
          tone={
            data.tiles.syncSuccessRatePct < 90
              ? 'danger'
              : data.tiles.syncSuccessRatePct < 98
                ? 'warning'
                : 'success'
          }
        />
        <Tile
          label="Failures (24h)"
          value={String(data.tiles.failures24h)}
          icon={AlertOctagon}
          tone={data.tiles.failures24h > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Stale failures"
          value={String(data.tiles.staleFailures)}
          icon={ShieldAlert}
          subText="> 24h old"
          tone={data.tiles.staleFailures > 0 ? 'danger' : 'default'}
        />
        <Tile
          label="Enabled sync rules"
          value={String(data.tiles.enabledRulesCount)}
          icon={ToggleRight}
        />
      </div>

      <SectionCard title="Daily sync — success vs failed">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.syncTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={20} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="success" stackId="s" fill="#10b981" radius={[0, 0, 0, 0]} />
            <Bar dataKey="failed" stackId="s" fill="#ef4444" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Per-entity success rate">
          {data.syncByEntity.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No sync events in window.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-1">Entity</th>
                  <th className="text-right font-medium pb-1">Total</th>
                  <th className="text-right font-medium pb-1">Failed</th>
                  <th className="text-right font-medium pb-1">Success rate</th>
                </tr>
              </thead>
              <tbody>
                {data.syncByEntity.map((r) => (
                  <tr key={r.entityType} className="border-t">
                    <td className="py-1.5">{r.entityType}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.total}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.failed}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">
                      {r.successRatePct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard title="Top failure clusters">
          {data.topFailures.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">No failures in window.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-1">Entity</th>
                  <th className="text-left font-medium pb-1">Error</th>
                  <th className="text-right font-medium pb-1">Count</th>
                </tr>
              </thead>
              <tbody>
                {data.topFailures.map((f, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="py-1.5">{f.entityType}</td>
                    <td className="py-1.5 truncate max-w-[300px]" title={f.errorMessage}>
                      {f.errorMessage}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{f.count}</td>
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

function InjectSection({ data }: { data: DataIntegrityAnalytics }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Records injected (lifetime)"
          value={data.tiles.totalRecordsSynced.toLocaleString('en-GB')}
          icon={Database}
        />
        <Tile
          label="Active inject sections"
          value={`${data.tiles.activeInjectSections} / ${data.injectSections.length}`}
          icon={ToggleRight}
        />
        <Tile label="Enabled rules" value={String(data.tiles.enabledRulesCount)} icon={Boxes} />
        <Tile label="Sync trend points" value={String(data.syncTrend.length)} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Sync rules — records synced per entity">
          {data.rules.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">No rules defined.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-1">Entity</th>
                  <th className="text-center font-medium pb-1">Enabled</th>
                  <th className="text-right font-medium pb-1">Records</th>
                  <th className="text-left font-medium pb-1">Last sync</th>
                </tr>
              </thead>
              <tbody>
                {data.rules.map((r) => (
                  <tr key={r.entity} className="border-t">
                    <td className="py-1.5">{r.entity}</td>
                    <td className="py-1.5 text-center">{r.enabled ? '✓' : ''}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {r.recordsSynced.toLocaleString('en-GB')}
                    </td>
                    <td className="py-1.5 text-muted-foreground">
                      {r.lastSyncedAt ? new Date(r.lastSyncedAt).toLocaleString('en-GB') : 'never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard title="Reports-injection sections">
          {data.injectSections.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No inject sections configured.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-1">Section</th>
                  <th className="text-center font-medium pb-1">Published</th>
                  <th className="text-left font-medium pb-1">Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.injectSections.map((s) => (
                  <tr key={s.section} className="border-t">
                    <td className="py-1.5 capitalize">{s.section.replace(/_/g, ' ')}</td>
                    <td className="py-1.5 text-center">
                      <span
                        className={
                          s.enabled
                            ? 'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700'
                            : 'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground'
                        }
                      >
                        {s.enabled ? 'ON' : 'OFF'}
                      </span>
                    </td>
                    <td className="py-1.5 text-muted-foreground">
                      {s.updatedAt ? new Date(s.updatedAt).toLocaleString('en-GB') : '—'}
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

function CompletenessSection({ data }: { data: DataIntegrityAnalytics }) {
  const p = data.completeness.patients
  const a = data.completeness.appointments
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Patients missing phone"
          value={`${p.missingPhonePct}%`}
          icon={ShieldAlert}
          subText={`of ${p.total} total`}
          tone={p.missingPhonePct > 10 ? 'warning' : 'default'}
        />
        <Tile
          label="Patients missing email"
          value={`${p.missingEmailPct}%`}
          icon={ShieldAlert}
          tone={p.missingEmailPct > 20 ? 'warning' : 'default'}
        />
        <Tile
          label="Patients missing DOB"
          value={`${p.missingDobPct}%`}
          icon={ShieldAlert}
          tone={p.missingDobPct > 5 ? 'warning' : 'default'}
        />
        <Tile
          label="Patients missing gender"
          value={`${p.missingGenderPct}%`}
          icon={ShieldAlert}
          tone={p.missingGenderPct > 5 ? 'warning' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Appointment completeness">
          <table className="w-full text-xs">
            <tbody>
              <tr className="border-t">
                <td className="py-1.5">Appointments missing doctor</td>
                <td className="py-1.5 text-right tabular-nums font-medium">
                  {a.missingDoctorPct}%
                </td>
              </tr>
              <tr className="border-t">
                <td className="py-1.5">Completed but missing completion timestamp</td>
                <td className="py-1.5 text-right tabular-nums font-medium">
                  {a.completedMissingTimestampsPct}%
                </td>
              </tr>
              <tr className="border-t">
                <td className="py-1.5">Total appointments</td>
                <td className="py-1.5 text-right tabular-nums">{a.total}</td>
              </tr>
            </tbody>
          </table>
        </SectionCard>

        <SectionCard title="Late-arriving patient records (per day)">
          {data.lateArrivals.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No late-arriving patient records detected.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={data.lateArrivals}
                margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>
    </>
  )
}

function AuditSection({ data }: { data: DataIntegrityAnalytics }) {
  return (
    <SectionCard title="Reports-injection toggle audit — most recent">
      {data.injectAudit.length === 0 ? (
        <p className="text-xs text-muted-foreground py-8 text-center">
          No toggle changes in window.
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium pb-1">When</th>
              <th className="text-left font-medium pb-1">Action</th>
              <th className="text-left font-medium pb-1">Section</th>
              <th className="text-left font-medium pb-1">User</th>
            </tr>
          </thead>
          <tbody>
            {data.injectAudit.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="py-1.5">
                  {row.createdAt ? new Date(row.createdAt).toLocaleString('en-GB') : '—'}
                </td>
                <td className="py-1.5">{row.action}</td>
                <td className="py-1.5">{row.entityName ?? '—'}</td>
                <td
                  className="py-1.5 truncate max-w-[120px] text-muted-foreground"
                  title={row.userId}
                >
                  {row.userId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  )
}
