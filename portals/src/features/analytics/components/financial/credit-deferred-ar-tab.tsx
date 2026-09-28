import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAnalyticsPeriod } from '@/features/analytics/period-context'
import { buildPeriodQuery } from '@/lib/actions/analytics'
import {
  getArByPayer,
  getCreditSummary,
  getDeferredRevenue,
} from '@/lib/actions/financial-analytics'
import { useApiQuery } from '@/lib/query'
import { GHS, SectionCard } from './shared'

const CREDIT_SUMMARY_KEY = (period: string) =>
  ['analytics', 'financial', 'credit-summary', period] as const
const DEFERRED_REVENUE_SUMMARY_KEY = (period: string) =>
  ['analytics', 'financial', 'deferred-revenue-summary', period] as const
const AR_BY_PAYER_KEY = ['analytics', 'financial', 'ar-by-payer'] as const

const GHS_COMPACT = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `GHS ${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `GHS ${(n / 1_000).toFixed(1)}K`
  return GHS(n)
}

const REASON_COLORS: Record<string, string> = {
  discount: '#3b82f6',
  correction: '#06b6d4',
  cancellation: '#f59e0b',
  goodwill: '#10b981',
  write_off: '#ef4444',
}

// ─── Credit notes / Write-offs / Refunds ────────────────────────────────────

export function FinancialCreditTab() {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(CREDIT_SUMMARY_KEY(periodQuery), () => getCreditSummary(periodQuery))
  const data = query.data ?? null
  const loading = query.isLoading
  const error = query.error ? query.error.message : null

  if (loading || !data) return <div className="h-72 rounded-xl border bg-muted/30 animate-pulse" />
  if (error)
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </p>
    )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          label="Total posted credits"
          value={GHS_COMPACT(data.tiles.totalPostedAmount)}
          subText={`${data.tiles.totalPostedCount} notes`}
        />
        <KpiTile label="Write-offs" value={GHS_COMPACT(data.tiles.writeOffAmount)} tone="danger" />
        <KpiTile
          label="Write-off ratio"
          value={`${data.tiles.writeOffRatioPct}%`}
          subText="of revenue"
          tone={
            data.tiles.writeOffRatioPct > 5
              ? 'danger'
              : data.tiles.writeOffRatioPct > 2
                ? 'warning'
                : 'default'
          }
        />
        <KpiTile label="Period revenue" value={GHS_COMPACT(data.tiles.totalRevenue)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Credit notes by reason">
          {data.byReason.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No credit notes posted in window.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.byReason} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="reason" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={GHS_COMPACT} />
                <Tooltip formatter={(value, name) => [GHS(value as number), name]} />
                <Bar dataKey="postedAmount" name="Posted amount">
                  {data.byReason.map((row) => (
                    <Cell key={row.reason} fill={REASON_COLORS[row.reason] ?? '#94a3b8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Credit-note volume by month">
          {data.monthly.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No credit notes in window.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.monthly} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={GHS_COMPACT} />
                <Tooltip formatter={(value, name) => [GHS(value as number), name]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="writeoff" stackId="m" name="Write-off" fill="#ef4444" />
                <Bar dataKey="refund" stackId="m" name="Refund" fill="#f59e0b" />
                <Bar dataKey="other" stackId="m" name="Other" fill="#94a3b8" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Reason detail">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium pb-1">Reason</th>
              <th className="text-right font-medium pb-1">Posted amount</th>
              <th className="text-right font-medium pb-1">Posted count</th>
              <th className="text-right font-medium pb-1">Total amount</th>
              <th className="text-right font-medium pb-1">Total count</th>
            </tr>
          </thead>
          <tbody>
            {data.byReason.map((r) => (
              <tr key={r.reason} className="border-t">
                <td className="py-1.5 capitalize">{r.reason.replace(/_/g, ' ')}</td>
                <td className="py-1.5 text-right tabular-nums">{GHS_COMPACT(r.postedAmount)}</td>
                <td className="py-1.5 text-right tabular-nums">{r.postedCount}</td>
                <td className="py-1.5 text-right tabular-nums">{GHS_COMPACT(r.amount)}</td>
                <td className="py-1.5 text-right tabular-nums">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </div>
  )
}

// ─── Deferred revenue waterfall ─────────────────────────────────────────────

export function FinancialDeferredRevenueTab() {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(DEFERRED_REVENUE_SUMMARY_KEY(periodQuery), () =>
    getDeferredRevenue(periodQuery)
  )
  const data = query.data ?? null
  const loading = query.isLoading
  const error = query.error ? query.error.message : null

  if (loading || !data) return <div className="h-72 rounded-xl border bg-muted/30 animate-pulse" />
  if (error)
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </p>
    )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          label="Total deferred on book"
          value={GHS_COMPACT(data.tiles.totalDeferred)}
          subText={`${data.tiles.deferredLineCount} lines`}
        />
        <KpiTile
          label="Recognized in period"
          value={GHS_COMPACT(data.tiles.totalRecognized)}
          subText={`${data.tiles.recognitionEvents} events`}
          tone="success"
        />
        <KpiTile
          label="Still deferred"
          value={GHS_COMPACT(data.tiles.stillDeferred)}
          tone={data.tiles.stillDeferred > 0 ? 'warning' : 'default'}
        />
        <KpiTile label="Recognition events" value={String(data.tiles.recognitionEvents)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Deferred → Recognized waterfall">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.waterfall} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="stage" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={GHS_COMPACT} />
              <Tooltip formatter={(value, name) => [GHS(value as number), name]} />
              <Bar dataKey="amount">
                {data.waterfall.map((row, idx) => (
                  <Cell
                    key={row.stage}
                    fill={['#6366f1', '#10b981', '#f59e0b'][idx] ?? '#94a3b8'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Recognition trigger mix">
          {data.byTrigger.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No recognition events in window.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-1">Trigger</th>
                  <th className="text-right font-medium pb-1">Amount</th>
                  <th className="text-right font-medium pb-1">Events</th>
                </tr>
              </thead>
              <tbody>
                {data.byTrigger.map((t) => (
                  <tr key={t.trigger} className="border-t">
                    <td className="py-1.5 capitalize">{t.trigger.replace(/_/g, ' ')}</td>
                    <td className="py-1.5 text-right tabular-nums">{GHS_COMPACT(t.amount)}</td>
                    <td className="py-1.5 text-right tabular-nums">{t.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Monthly recognition trend">
        {data.monthly.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">
            No recognition events in window.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.monthly} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={GHS_COMPACT} />
              <Tooltip formatter={(value, name) => [GHS(value as number), name]} />
              <Line type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </SectionCard>
    </div>
  )
}

// ─── A/R by payer ───────────────────────────────────────────────────────────

export function FinancialArByPayerTab() {
  const query = useApiQuery(AR_BY_PAYER_KEY, getArByPayer)
  const data = query.data ?? null
  const loading = query.isLoading
  const error = query.error ? query.error.message : null

  if (loading || !data) return <div className="h-72 rounded-xl border bg-muted/30 animate-pulse" />
  if (error)
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </p>
    )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Total A/R" value={GHS_COMPACT(data.tiles.totalAR)} />
        <KpiTile
          label="Insured A/R"
          value={GHS_COMPACT(data.tiles.insuredAR)}
          subText={`${data.tiles.insuredSharePct}% of A/R`}
          tone={data.tiles.insuredSharePct > 50 ? 'warning' : 'default'}
        />
        <KpiTile label="Self-pay A/R" value={GHS_COMPACT(data.tiles.selfPayAR)} />
        <KpiTile label="Payer count" value={String(data.tiles.payerCount)} />
      </div>

      <SectionCard title="A/R by payer">
        {data.byPayer.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">No outstanding A/R.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-medium pb-1">Payer</th>
                <th className="text-right font-medium pb-1">Patients</th>
                <th className="text-right font-medium pb-1">Balance</th>
                <th className="text-right font-medium pb-1">Share</th>
              </tr>
            </thead>
            <tbody>
              {data.byPayer.map((p) => (
                <tr key={p.payer} className="border-t">
                  <td className="py-1.5">{p.payer}</td>
                  <td className="py-1.5 text-right tabular-nums">{p.patientCount}</td>
                  <td className="py-1.5 text-right tabular-nums">{GHS_COMPACT(p.balance)}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">
                    {data.tiles.totalAR > 0
                      ? Math.round((p.balance / data.tiles.totalAR) * 1000) / 10
                      : 0}
                    %
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  )
}

// ─── Tile (matches the financial-page style: compact, single label/value/sub) ─

function KpiTile({
  label,
  value,
  subText,
  tone = 'default',
}: {
  label: string
  value: string
  subText?: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50/30'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50/30'
        : tone === 'danger'
          ? 'border-red-200 bg-red-50/30'
          : 'border-border'
  return (
    <div className={`rounded-xl border ${toneClass} p-4 flex flex-col gap-1`}>
      <p className="text-xs text-muted-foreground leading-tight">{label}</p>
      <p className="text-xl font-bold leading-tight">{value}</p>
      {subText && <p className="text-[11px] text-muted-foreground">{subText}</p>}
    </div>
  )
}
