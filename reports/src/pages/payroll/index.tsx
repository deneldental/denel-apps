// PR-23 — Reports app payroll viewer (read-only).
//
// Surfaces published payroll runs so finance can audit the totals without
// reaching into HR's payroll-runs page. Read-only by design: the runs and
// their payslips are owned by HR; this view never offers actions that
// mutate them. Future drill-down (per-staff payslip view) can be added as
// a sub-route — keeping this page lean for now.

import { formatCurrency } from '@denel/utils'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-client'

type PayrollRun = {
  id: string
  name: string
  payPeriodStart: string
  payPeriodEnd: string
  status: 'draft' | 'locked' | 'published' | 'archived' | string
  totalGross: string | null
  totalNet: string | null
  totalPaye: string | null
  totalSsnit: string | null
  staffCount: number
  lockedAt: string | null
  publishedAt: string | null
  createdAt: string
}

/** Cents in, `'GH₵1,234.56'` out — or an em dash for a missing value. */
function ghs(value: string | number | null): string {
  if (value == null) return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  return formatCurrency(n)
}

function statusClass(status: string): string {
  switch (status) {
    case 'published':
      return 'bg-emerald-100 text-emerald-800'
    case 'locked':
      return 'bg-amber-100 text-amber-800'
    case 'archived':
      return 'bg-slate-100 text-slate-600'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function formatPeriod(startIso: string, endIso: string): string {
  try {
    const start = new Date(startIso)
    const end = new Date(endIso)
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
    return `${start.toLocaleDateString('en-GH', opts)} – ${end.toLocaleDateString('en-GH', opts)}`
  } catch {
    return `${startIso} – ${endIso}`
  }
}

export default function PayrollPage() {
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    void api.get<PayrollRun[]>('/api/payroll/runs').then((res) => {
      setLoading(false)
      if (res.success && Array.isArray(res.data)) {
        setRuns(res.data)
      } else {
        setError(res.error || 'Failed to load payroll runs')
        setRuns([])
      }
    })
  }, [])

  // Published runs are what finance actually relies on; the others are
  // surfaced lower in the table for context but visually de-emphasized.
  const published = runs.filter((r) => r.status === 'published')
  const inFlight = runs.filter((r) => r.status !== 'published')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold md:text-2xl">Payroll</h1>
        <p className="text-sm text-muted-foreground">
          Read-only view of payroll runs. Edits happen in HR; finance verifies the numbers here.
        </p>
      </div>

      {loading && (
        <div className="rounded-lg border p-6 text-sm text-muted-foreground">Loading…</div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && runs.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No payroll runs on file yet. Ask HR to lock the first run.
          </p>
        </div>
      )}

      {published.length > 0 && <RunsTable title="Published" emptyHint="" rows={published} />}
      {inFlight.length > 0 && (
        <RunsTable
          title="In flight"
          emptyHint="Drafts, locked, and archived runs. Numbers may still change."
          rows={inFlight}
          muted
        />
      )}
    </div>
  )
}

function RunsTable({
  title,
  emptyHint,
  rows,
  muted,
}: {
  title: string
  emptyHint: string
  rows: PayrollRun[]
  muted?: boolean
}) {
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {emptyHint && <p className="text-xs text-muted-foreground">{emptyHint}</p>}
      </div>
      <div className={`rounded-lg border ${muted ? 'opacity-80' : ''}`}>
        <div className="grid grid-cols-[1.5fr_2fr_auto_1fr_1fr_1fr_1fr_auto] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>Name</span>
          <span>Period</span>
          <span>Staff</span>
          <span>Gross</span>
          <span>PAYE</span>
          <span>SSNIT</span>
          <span>Net</span>
          <span>Status</span>
        </div>
        {rows.map((run) => (
          <Link
            key={run.id}
            to={`/payroll/${run.id}`}
            className="grid grid-cols-[1.5fr_2fr_auto_1fr_1fr_1fr_1fr_auto] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0 hover:bg-muted/30 transition-colors"
          >
            <span className="font-medium">{run.name}</span>
            <span className="text-muted-foreground">
              {formatPeriod(run.payPeriodStart, run.payPeriodEnd)}
            </span>
            <span className="tabular-nums">{run.staffCount}</span>
            <span className="tabular-nums">{ghs(run.totalGross)}</span>
            <span className="tabular-nums">{ghs(run.totalPaye)}</span>
            <span className="tabular-nums">{ghs(run.totalSsnit)}</span>
            <span className="font-medium tabular-nums">{ghs(run.totalNet)}</span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusClass(
                run.status
              )}`}
            >
              {run.status}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
