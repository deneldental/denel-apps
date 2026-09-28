// PR-24 — Reports payroll drill-down.
//
// Per-run payslip viewer. Read-only by design: this surface is for finance
// to verify the rows behind a payroll-run totals card, not to mutate them.
// Mutations stay on the HR side.
//
// Payslips don't carry a FK column to payroll_runs — the backend filters by
// `deductions->>'payrollRunId'`, so this view is just a thin client over
// the existing /api/payroll/runs/:runId/payslips response.

import { formatCurrency } from '@denel/utils'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/lib/api-client'

type RunSummary = {
  id: string
  name: string
  payPeriodStart: string
  payPeriodEnd: string
  status: string
  totalGross: string | null
  totalNet: string | null
  totalPaye: string | null
  totalSsnit: string | null
  staffCount: number
  publishedAt: string | null
}

type PayslipDeductions = {
  paye?: number
  ssnit_employee?: number
  ssnit_employer?: number
  loan?: number
  other?: Array<{ label?: string; amount?: number }>
} | null

type PayslipRow = {
  id: string
  staffId: string
  staffName: string
  payPeriod: string
  grossPay: string | null
  netPay: string | null
  deductions: PayslipDeductions
  status: string
  publishedAt: string | null
}

// This page reads money in TWO different units, so it needs two formatters.
//
// `payroll_runs.total*` and `payslips.grossPay/netPay` are DB columns, and
// migration 0209 converted them to integer CENTS. The `deductions` JSONB blob
// was NOT converted — payroll.ts builds it with `Money.toNumber()`, which
// emits CEDIS, and 0209 does not touch JSONB. Do not merge these two helpers.

/** For DB money columns — integer CENTS in. Em dash for a missing value. */
function ghs(value: string | number | null | undefined): string {
  if (value == null) return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  return formatCurrency(n)
}

/** For values read out of the `deductions` JSONB — CEDIS in, not cents. */
function ghsFromCedis(value: string | number | null | undefined): string {
  if (value == null) return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  return formatCurrency(Math.round(n * 100))
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

export default function PayrollRunDetailPage() {
  const { runId } = useParams<{ runId: string }>()
  const [run, setRun] = useState<RunSummary | null>(null)
  const [rows, setRows] = useState<PayslipRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!runId) return
    setLoading(true)
    void api
      .get<{ run: RunSummary; payslips: PayslipRow[] }>(`/api/payroll/runs/${runId}/payslips`)
      .then((res) => {
        setLoading(false)
        if (res.success && res.data) {
          setRun(res.data.run)
          setRows(res.data.payslips)
        } else {
          setError(res.error || 'Failed to load payroll run')
        }
      })
  }, [runId])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/finance/payroll" className="text-sm text-muted-foreground hover:underline">
          ← Back to payroll
        </Link>
        <h1 className="mt-1 text-lg font-semibold md:text-2xl">{run?.name ?? 'Payroll run'}</h1>
        {run && (
          <p className="text-sm text-muted-foreground">
            {formatPeriod(run.payPeriodStart, run.payPeriodEnd)} · {run.staffCount} staff ·{' '}
            <span className="capitalize">{run.status}</span>
          </p>
        )}
      </div>

      {loading && (
        <div className="rounded-lg border p-6 text-sm text-muted-foreground">Loading…</div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {run && !loading && !error && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Gross" value={ghs(run.totalGross)} />
          <Stat label="PAYE" value={ghs(run.totalPaye)} />
          <Stat label="SSNIT" value={ghs(run.totalSsnit)} />
          <Stat label="Net" value={ghs(run.totalNet)} accent />
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No payslips in this run yet.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="rounded-lg border">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>Staff</span>
            <span>Gross</span>
            <span>PAYE</span>
            <span>SSNIT (employee)</span>
            <span>Net</span>
            <span>Status</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{row.staffName}</p>
                <p className="text-xs text-muted-foreground">{row.payPeriod}</p>
              </div>
              <span className="tabular-nums">{ghs(row.grossPay)}</span>
              <span className="tabular-nums">{ghsFromCedis(row.deductions?.paye ?? null)}</span>
              <span className="tabular-nums">
                {ghsFromCedis(row.deductions?.ssnit_employee ?? null)}
              </span>
              <span className="font-medium tabular-nums">{ghs(row.netPay)}</span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                  row.status === 'published'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {row.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${accent ? 'text-emerald-700' : ''}`}>
        {value}
      </p>
    </div>
  )
}
