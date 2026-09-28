import {
  Bell,
  CalendarHeart,
  Heart,
  type LucideIcon,
  Mail,
  MessageSquare,
  Send,
  Smartphone,
  Users,
} from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAnalyticsPeriod } from '@/features/analytics/period-context'
import { buildPeriodQuery, type CrmAnalytics, getCrmAnalytics } from '@/lib/actions/analytics'
import { useApiQuery } from '@/lib/query'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'

const CRM_KEY = (period: string) => ['analytics', 'crm', period] as const

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

const TAB_IDS = ['recare', 'campaigns', 'channels', 'pwa'] as const
type TabId = (typeof TAB_IDS)[number]

export default function CrmAnalyticsPage({ printMode = false }: { printMode?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') as TabId | null
  const activeTab: TabId = TAB_IDS.includes(tabParam as TabId) ? (tabParam as TabId) : 'recare'

  function setTab(t: TabId) {
    const next = new URLSearchParams(searchParams)
    if (t === 'recare') next.delete('tab')
    else next.set('tab', t)
    setSearchParams(next, { replace: true })
  }

  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(CRM_KEY(periodQuery), () => getCrmAnalytics(periodQuery))
  const data = query.data ?? null
  const loading = query.isLoading
  const error = query.error ? query.error.message : null

  if (printMode) {
    return (
      <div className="flex flex-col gap-8 p-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">CRM</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recare adherence, campaign volume, channel mix, PWA engagement.
          </p>
        </header>
        {loading || !data ? (
          <PageLoader />
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold border-b pb-1">Recare</h2>
              <RecareSection data={data} />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold border-b pb-1">Campaigns</h2>
              <CampaignsSection data={data} />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold border-b pb-1">Channels</h2>
              <ChannelsSection data={data} />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold border-b pb-1">PWA engagement</h2>
              <PwaSection data={data} />
            </section>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">CRM</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Patient communications, recare adherence, and PWA engagement.
        </p>
      </header>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabId)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="recare">Recare</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="pwa">PWA</TabsTrigger>
        </TabsList>
        <TabsContent value="recare" className="space-y-4">
          {loading || !data ? <PageLoader /> : <RecareSection data={data} />}
        </TabsContent>
        <TabsContent value="campaigns" className="space-y-4">
          {loading || !data ? <PageLoader /> : <CampaignsSection data={data} />}
        </TabsContent>
        <TabsContent value="channels" className="space-y-4">
          {loading || !data ? <PageLoader /> : <ChannelsSection data={data} />}
        </TabsContent>
        <TabsContent value="pwa" className="space-y-4">
          {loading || !data ? <PageLoader /> : <PwaSection data={data} />}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Recare ────────────────────────────────────────────────────────────────

function RecareSection({ data }: { data: CrmAnalytics }) {
  const statusData = Object.entries(data.recareStatus).map(([status, count]) => ({
    status,
    count,
  }))
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Active recare plans"
          value={String(data.tiles.recareActive)}
          icon={CalendarHeart}
        />
        <Tile
          label="Due now"
          value={String(data.tiles.recareDueNow)}
          icon={Bell}
          tone={data.tiles.recareDueNow > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Completed in period"
          value={String(data.tiles.recareCompletedInPeriod)}
          icon={Heart}
          tone="success"
        />
        <Tile
          label="Adherence rate"
          value={`${data.tiles.recareAdherencePct}%`}
          icon={Heart}
          tone={data.tiles.recareAdherencePct < 30 ? 'warning' : 'success'}
        />
      </div>
      <SectionCard title="Recare status mix">
        {statusData.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">No active recare plans.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={statusData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="status" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </SectionCard>
    </>
  )
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

function CampaignsSection({ data }: { data: CrmAnalytics }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="SMS sent" value={String(data.tiles.smsSent)} icon={MessageSquare} />
        <Tile label="Emails sent" value={String(data.tiles.emailSent)} icon={Mail} />
        <Tile
          label="SMS delivery rate"
          value={`${data.tiles.smsDeliveryRatePct}%`}
          icon={Send}
          tone={data.tiles.smsDeliveryRatePct < 80 ? 'warning' : 'success'}
        />
        <Tile label="Active templates" value={String(data.templateUsage.length)} icon={Send} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Top reminder templates by usage">
          {data.templateUsage.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No templates used in window.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-1">Template</th>
                  <th className="text-right font-medium pb-1">Sent</th>
                  <th className="text-right font-medium pb-1">Total</th>
                  <th className="text-right font-medium pb-1">Send rate</th>
                </tr>
              </thead>
              <tbody>
                {data.templateUsage.map((t) => (
                  <tr key={t.templateId ?? t.templateName} className="border-t">
                    <td className="py-1.5">{t.templateName}</td>
                    <td className="py-1.5 text-right tabular-nums">{t.sent}</td>
                    <td className="py-1.5 text-right tabular-nums">{t.total}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">{t.sendRatePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard title="Scheduled reminders by type">
          {data.remindersByType.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No scheduled reminders in window.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={data.remindersByType}
                margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="type" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#06b6d4" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>
    </>
  )
}

// ─── Channels ──────────────────────────────────────────────────────────────

const CHANNEL_COLORS = ['#10b981', '#f59e0b', '#06b6d4', '#8b5cf6', '#ef4444', '#6366f1']

function ChannelsSection({ data }: { data: CrmAnalytics }) {
  const smsByType = Object.entries(data.smsByType).map(([type, count]) => ({ type, count }))
  const emailByType = Object.entries(data.emailByType).map(([type, count]) => ({ type, count }))

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="SMS volume" value={String(data.tiles.smsSent)} icon={MessageSquare} />
        <Tile label="Email volume" value={String(data.tiles.emailSent)} icon={Mail} />
        <Tile
          label="Push subscribers"
          value={String(data.tiles.staffPushSubscribers)}
          icon={Bell}
        />
        <Tile
          label="SMS delivery rate"
          value={`${data.tiles.smsDeliveryRatePct}%`}
          icon={Send}
          tone={data.tiles.smsDeliveryRatePct < 80 ? 'warning' : 'success'}
        />
      </div>

      <SectionCard title="Daily SMS volume">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data.smsTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={20} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="SMS mix by type">
          {smsByType.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">No SMS in window.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={smsByType} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="type" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count">
                  {smsByType.map((_, idx) => (
                    <Cell key={idx} fill={CHANNEL_COLORS[idx % CHANNEL_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Email mix by type">
          {emailByType.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">No emails in window.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={emailByType} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="type" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count">
                  {emailByType.map((_, idx) => (
                    <Cell key={idx} fill={CHANNEL_COLORS[idx % CHANNEL_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>
    </>
  )
}

// ─── PWA ───────────────────────────────────────────────────────────────────

function PwaSection({ data }: { data: CrmAnalytics }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Total patients" value={String(data.pwaFunnel[0]?.count ?? 0)} icon={Users} />
        <Tile label="PWA enabled" value={String(data.tiles.pwaEnabled)} icon={Smartphone} />
        <Tile
          label="Enable rate"
          value={`${data.tiles.pwaEnableRatePct}%`}
          icon={Smartphone}
          subText="of total patients"
        />
        <Tile
          label="Active in period"
          value={String(data.tiles.pwaActiveInPeriod)}
          icon={Smartphone}
          subText={`${data.tiles.pwaActiveRatePct}% of enabled`}
          tone={data.tiles.pwaActiveRatePct < 30 ? 'warning' : 'success'}
        />
      </div>

      <SectionCard title="PWA activation funnel">
        <ResponsiveContainer width="100%" height={240}>
          <FunnelChart>
            <Tooltip />
            <Funnel dataKey="count" data={data.pwaFunnel} isAnimationActive>
              <LabelList position="right" fill="#000" stroke="none" dataKey="stage" />
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </SectionCard>
    </>
  )
}
