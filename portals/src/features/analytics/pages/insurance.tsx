import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  type LucideIcon,
  ShieldCheck,
  TrendingDown,
  Wallet,
} from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAnalyticsPeriod } from '@/features/analytics/period-context'
import {
  buildPeriodQuery,
  getInsuranceAnalytics,
  getInsuranceClaimPipeline,
  type InsuranceAnalytics,
  type InsuranceClaimPipelineData,
} from '@/lib/actions/analytics'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { formatAmount } from '@/shared/utils/currency'

const INSURANCE_CLAIM_PIPELINE_KEY = (period: string) =>
  ['analytics', 'insurance', 'claim-pipeline', period] as const

const GHS = (n: number) => `GHS ${formatAmount(n)}`
const GHS_COMPACT = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `GHS ${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `GHS ${(n / 1_000).toFixed(1)}K`
  return GHS(n)
}

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

const TAB_IDS = ['payer-mix', 'reconciliation', 'pricing', 'claims'] as const
type TabId = (typeof TAB_IDS)[number]

const METHOD_COLORS: Record<string, string> = {
  cash: '#10b981',
  card: '#3b82f6',
  momo: '#f59e0b',
  insurance: '#8b5cf6',
  transfer: '#06b6d4',
  bank_transfer: '#06b6d4',
  other: '#94a3b8',
}

export default function InsuranceAnalyticsPage({ printMode = false }: { printMode?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') as TabId | null
  const activeTab: TabId = TAB_IDS.includes(tabParam as TabId) ? (tabParam as TabId) : 'payer-mix'

  function setTab(t: TabId) {
    const next = new URLSearchParams(searchParams)
    if (t === 'payer-mix') next.delete('tab')
    else next.set('tab', t)
    setSearchParams(next, { replace: true })
  }

  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const dataQuery = useApiQuery(queryKeys.analytics.insurance({ query: periodQuery }), () =>
    getInsuranceAnalytics(periodQuery)
  )
  const claimsQuery = useApiQuery(INSURANCE_CLAIM_PIPELINE_KEY(periodQuery), () =>
    getInsuranceClaimPipeline(periodQuery)
  )
  const data = dataQuery.data ?? null
  const loading = dataQuery.isLoading
  const error = dataQuery.error ? dataQuery.error.message : null
  const claimsData = claimsQuery.data ?? null
  const claimsLoading = claimsQuery.isLoading

  if (printMode) {
    return (
      <div className="flex flex-col gap-8 p-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Insurance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Payer mix, reconciliation backlog, pricing-document drift, and claim pipeline.
          </p>
        </header>
        {loading || !data ? (
          <PageLoader />
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold border-b pb-1">Payer mix</h2>
              <PayerMixSection data={data} />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold border-b pb-1">Reconciliation</h2>
              <ReconciliationSection data={data} />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold border-b pb-1">Pricing documents</h2>
              <PricingSection data={data} />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold border-b pb-1">Claim pipeline</h2>
              {claimsLoading || !claimsData ? (
                <PageLoader />
              ) : (
                <ClaimPipelineSection data={claimsData} />
              )}
            </section>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Insurance</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Insurance vs out-of-pocket mix, reconciliation status, and pricing snapshots.
        </p>
      </header>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabId)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="payer-mix">Payer mix</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="claims">Claim pipeline</TabsTrigger>
        </TabsList>
        <TabsContent value="payer-mix" className="space-y-4">
          {loading || !data ? <PageLoader /> : <PayerMixSection data={data} />}
        </TabsContent>
        <TabsContent value="reconciliation" className="space-y-4">
          {loading || !data ? <PageLoader /> : <ReconciliationSection data={data} />}
        </TabsContent>
        <TabsContent value="pricing" className="space-y-4">
          {loading || !data ? <PageLoader /> : <PricingSection data={data} />}
        </TabsContent>
        <TabsContent value="claims" className="space-y-4">
          {claimsLoading || !claimsData ? (
            <PageLoader />
          ) : (
            <ClaimPipelineSection data={claimsData} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function PayerMixSection({ data }: { data: InsuranceAnalytics }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Insurance share"
          value={`${data.tiles.insuranceSharePct}%`}
          icon={ShieldCheck}
          subText={`of ${GHS_COMPACT(data.tiles.insuranceAmount + data.tiles.oopAmount)} revenue`}
        />
        <Tile
          label="Insurance revenue"
          value={GHS_COMPACT(data.tiles.insuranceAmount)}
          icon={Wallet}
        />
        <Tile label="OOP revenue" value={GHS_COMPACT(data.tiles.oopAmount)} icon={Wallet} />
        <Tile
          label="Active companies"
          value={String(data.tiles.activeCompanies)}
          icon={Building2}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Insurance vs OOP — monthly trend">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.monthlyMix} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={GHS_COMPACT} />
              <Tooltip formatter={(value, name) => [GHS(value as number), name]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area
                type="monotone"
                stackId="r"
                dataKey="insurance"
                stroke="#8b5cf6"
                fill="#8b5cf6"
                fillOpacity={0.6}
              />
              <Area
                type="monotone"
                stackId="r"
                dataKey="oop"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.6}
              />
            </AreaChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Payment method mix">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.methodMix} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="method" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={GHS_COMPACT} />
              <Tooltip formatter={(value, name) => [GHS(value as number), name]} />
              <Bar dataKey="amount">
                {data.methodMix.map((row) => (
                  <Cell key={row.method} fill={METHOD_COLORS[row.method] ?? METHOD_COLORS.other} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>
    </>
  )
}

function ReconciliationSection({ data }: { data: InsuranceAnalytics }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Charged"
          value={GHS_COMPACT(data.tiles.totalCharged)}
          icon={FileText}
          subText="Within window"
        />
        <Tile
          label="Paid back"
          value={GHS_COMPACT(data.tiles.totalPaid)}
          icon={CheckCircle2}
          tone="success"
        />
        <Tile
          label="Outstanding"
          value={GHS_COMPACT(data.tiles.outstandingReconciliation)}
          icon={Clock}
          subText={`${data.tiles.outstandingReconciliationCount} records`}
          tone={data.tiles.outstandingReconciliation > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Active companies"
          value={String(data.tiles.activeCompanies)}
          icon={Building2}
        />
      </div>

      <SectionCard title="Reconciliation by company">
        {data.reconciliation.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">
            No reconciliation records in window.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-medium pb-1">Company</th>
                <th className="text-right font-medium pb-1">Charged</th>
                <th className="text-right font-medium pb-1">Paid</th>
                <th className="text-right font-medium pb-1">Outstanding</th>
                <th className="text-right font-medium pb-1">Reconciled</th>
              </tr>
            </thead>
            <tbody>
              {data.reconciliation.map((r) => (
                <tr key={r.companyId} className="border-t">
                  <td className="py-1.5">{r.companyName}</td>
                  <td className="py-1.5 text-right tabular-nums">{GHS_COMPACT(r.charged)}</td>
                  <td className="py-1.5 text-right tabular-nums">{GHS_COMPACT(r.paid)}</td>
                  <td className="py-1.5 text-right tabular-nums">{GHS_COMPACT(r.outstanding)}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">
                    {r.reconciledCount}/{r.totalCount} ({r.reconciliationRatePct}%)
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

const STATUS_COLORS: Record<string, string> = {
  pending: '#94a3b8',
  submitted: '#3b82f6',
  approved: '#10b981',
  denied: '#ef4444',
  paid: '#8b5cf6',
}

function ClaimPipelineSection({ data }: { data: InsuranceClaimPipelineData }) {
  const funnelTotal = data.funnel.reduce((s, r) => s + r.count, 0)
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="Total claims" value={String(data.tiles.totalClaims)} icon={FileText} />
        <Tile label="Total charged" value={GHS_COMPACT(data.tiles.totalCharged)} icon={Wallet} />
        <Tile
          label="Denial rate"
          value={`${data.tiles.denialRatePct}%`}
          icon={TrendingDown}
          tone={
            data.tiles.denialRatePct > 15
              ? 'danger'
              : data.tiles.denialRatePct > 5
                ? 'warning'
                : 'success'
          }
        />
        <Tile
          label="Approval rate"
          value={`${data.tiles.approvalRatePct}%`}
          icon={CheckCircle2}
          tone={data.tiles.approvalRatePct > 80 ? 'success' : 'warning'}
        />
        <Tile
          label="Pending claims"
          value={String(data.tiles.pendingCount)}
          icon={Clock}
          subText={GHS_COMPACT(data.tiles.pendingAmount)}
          tone={data.tiles.pendingCount > 20 ? 'warning' : 'default'}
        />
        <Tile
          label="Open amount"
          value={GHS_COMPACT(data.tiles.pendingAmount)}
          icon={AlertTriangle}
          tone={data.tiles.pendingAmount > 10000 ? 'danger' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Status funnel">
          {data.funnel.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">No claims in window.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {['pending', 'submitted', 'approved', 'denied', 'paid']
                .map((s) => data.funnel.find((r) => r.status === s))
                .filter((r): r is NonNullable<typeof r> => !!r && r.status !== undefined)
                .map((r) => {
                  const pct = funnelTotal > 0 ? Math.round((r.count / funnelTotal) * 100) : 0
                  return (
                    <div key={r.status} className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          background:
                            STATUS_COLORS[r.status as keyof typeof STATUS_COLORS] ?? '#94a3b8',
                        }}
                      />
                      <span className="text-xs capitalize w-20 shrink-0">{r.status}</span>
                      <div className="flex-1 h-4 rounded bg-muted overflow-hidden">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${pct}%`,
                            background:
                              STATUS_COLORS[r.status as keyof typeof STATUS_COLORS] ?? '#94a3b8',
                          }}
                        />
                      </div>
                      <span className="text-xs tabular-nums w-8 text-right">{r.count}</span>
                      <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                    </div>
                  )
                })}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Monthly submission trend">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.monthlyTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="submitted" fill="#3b82f6" name="Submitted" />
              <Bar dataKey="approved" fill="#10b981" name="Approved" />
              <Bar dataKey="denied" fill="#ef4444" name="Denied" />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      <SectionCard title="Claims by company">
        {data.byCompany.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">No claim data in window.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-medium pb-1">Company</th>
                <th className="text-right font-medium pb-1">Claims</th>
                <th className="text-right font-medium pb-1">Denial rate</th>
                <th className="text-right font-medium pb-1">Avg days to approval</th>
                <th className="text-right font-medium pb-1">Charged</th>
                <th className="text-right font-medium pb-1">Approved</th>
              </tr>
            </thead>
            <tbody>
              {data.byCompany.map((r) => (
                <tr key={r.companyId} className="border-t">
                  <td className="py-1.5">{r.companyName}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.totalClaims}</td>
                  <td
                    className={`py-1.5 text-right tabular-nums font-medium ${r.denialRatePct > 15 ? 'text-red-600' : r.denialRatePct > 5 ? 'text-amber-600' : 'text-emerald-600'}`}
                  >
                    {r.denialRatePct}%
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {r.avgDaysToApproval != null ? `${r.avgDaysToApproval}d` : '—'}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{GHS_COMPACT(r.totalCharged)}</td>
                  <td className="py-1.5 text-right tabular-nums">{GHS_COMPACT(r.totalApproved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      <SectionCard title="Open claim aging">
        {data.claimAging.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">
            No open submitted claims.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-medium pb-1">Age bucket</th>
                <th className="text-right font-medium pb-1">Claims</th>
                <th className="text-right font-medium pb-1">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.claimAging.map((r) => (
                <tr key={r.bucket} className="border-t">
                  <td className="py-1.5">{r.bucket}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.count}</td>
                  <td className="py-1.5 text-right tabular-nums">{GHS_COMPACT(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </>
  )
}

function PricingSection({ data }: { data: InsuranceAnalytics }) {
  return (
    <SectionCard title="Pricing documents — most recent first">
      {data.pricingDocs.length === 0 ? (
        <p className="text-xs text-muted-foreground py-8 text-center">
          No pricing documents on file.
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium pb-1">Company</th>
              <th className="text-left font-medium pb-1">File</th>
              <th className="text-left font-medium pb-1">Version</th>
              <th className="text-left font-medium pb-1">Effective from</th>
              <th className="text-left font-medium pb-1">Uploaded</th>
              <th className="text-center font-medium pb-1">Active</th>
            </tr>
          </thead>
          <tbody>
            {data.pricingDocs.map((doc, idx) => (
              <tr key={`${doc.companyId}-${idx}`} className="border-t">
                <td className="py-1.5">{doc.companyName}</td>
                <td className="py-1.5 truncate max-w-[200px]" title={doc.fileName}>
                  {doc.fileName}
                </td>
                <td className="py-1.5">{doc.version ?? '—'}</td>
                <td className="py-1.5">
                  {doc.effectiveFrom
                    ? new Date(doc.effectiveFrom).toLocaleDateString('en-GB')
                    : '—'}
                </td>
                <td className="py-1.5">
                  {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString('en-GB') : '—'}
                </td>
                <td className="py-1.5 text-center">{doc.isCurrent ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  )
}
