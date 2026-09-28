import { Banknote, CheckCircle2, Clock, Receipt, RefreshCw } from 'lucide-react'
import { getInsuranceClaims, type InsuranceClaim } from '@/lib/actions/insurance-claims'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { formatAmount } from '@/shared/utils/currency'
import type { ReconciliationEntry } from '../types'

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const ghs = (n: number) => `GHS ${formatAmount(n)}`

const CLAIM_STATUSES: Array<{ key: InsuranceClaim['status']; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'approved', label: 'Approved' },
  { key: 'paid', label: 'Paid' },
  { key: 'denied', label: 'Denied' },
]

export default function InsuranceSummaryPage() {
  const claimsQuery = useApiQuery<InsuranceClaim[]>(queryKeys.insurance.claims(), () =>
    getInsuranceClaims()
  )
  const claims = claimsQuery.data ?? []
  const reconciliationQuery = useApiQuery<ReconciliationEntry[]>(
    queryKeys.insurance.reconciliation(),
    () => api.get<ReconciliationEntry[]>('/api/insurance/reconciliation')
  )
  const reconciliation = reconciliationQuery.data ?? []
  const loading = claimsQuery.isLoading || reconciliationQuery.isLoading

  const load = () => {
    claimsQuery.refetch()
    reconciliationQuery.refetch()
  }

  // Claims
  const totalClaims = claims.length
  const paidClaims = claims.filter((c) => c.status === 'paid').length
  const totalBilled = claims.reduce((s, c) => s + num(c.chargedAmount), 0)

  // Reconciliation
  const reconciledEntries = reconciliation.filter((r) => r.reconciledAt)
  const amountReconciled = reconciledEntries.reduce((s, r) => s + num(r.insurerPaidAmount), 0)
  const awaitingInsurer = reconciliation
    .filter((r) => !r.reconciledAt)
    .reduce((s, r) => s + num(r.chargedAmount), 0)

  const statusCounts = CLAIM_STATUSES.map((s) => ({
    ...s,
    count: claims.filter((c) => c.status === s.key).length,
  }))

  const cards = [
    {
      label: 'Total claims',
      value: loading ? '—' : String(totalClaims),
      sub: loading ? '' : `${paidClaims} paid`,
      icon: Receipt,
      tone: 'text-foreground',
    },
    {
      label: 'Amount reconciled',
      value: loading ? '—' : ghs(amountReconciled),
      sub: loading ? '' : `${reconciledEntries.length} settled`,
      icon: CheckCircle2,
      tone: 'text-emerald-600',
    },
    {
      label: 'Awaiting insurer',
      value: loading ? '—' : ghs(awaitingInsurer),
      sub: loading ? '' : `${reconciliation.length - reconciledEntries.length} unreconciled`,
      icon: Clock,
      tone: 'text-amber-600',
    },
    {
      label: 'Total billed',
      value: loading ? '—' : ghs(totalBilled),
      sub: 'across all claims',
      icon: Banknote,
      tone: 'text-foreground',
    },
  ]

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Insurance</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Claims volume and insurer settlement at a glance.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Operational stat cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-sm"
          >
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <card.icon className={`h-4 w-4 ${card.tone}`} />
              <span>{card.label}</span>
            </div>
            <p className={`text-2xl font-bold tabular-nums ${card.tone}`}>{card.value}</p>
            {card.sub && <p className="text-xs text-muted-foreground">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Claims by status */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-medium">Claims by status</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : totalClaims === 0 ? (
          <p className="text-sm text-muted-foreground">
            No claims yet. File one from the Claims tab.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {statusCounts.map((s) => (
              <Badge key={s.key} variant="outline" className="gap-1.5 px-2.5 py-1 text-xs">
                {s.label}
                <span className="tabular-nums font-semibold">{s.count}</span>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
