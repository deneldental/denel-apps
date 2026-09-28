import { DollarSign, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-client'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { downloadCsv, todayStamp } from '@/shared/utils/csv'
import { formatAmount, formatCurrency, formatCurrencyCompact } from '@/shared/utils/currency'

type AgingRow = {
  patientId: string
  patientName: string
  patientIdStr: string | null
  current: number
  bucket30: number
  bucket60: number
  bucket90: number
  total: number
  oldestOverdueDate: string | null
}

type AgingPayload = {
  rows: AgingRow[]
  summary: { current: number; bucket30: number; bucket60: number; bucket90: number; total: number }
  patientCount: number
}

/**
 * Accounts Receivable Aging — reusable section embeddable inside the Analytics
 * tabbed shell. Renders summary tiles + patient drill-down table + CSV export.
 * Has no page-level chrome (header sits in the analytics tab UI above).
 */
export function AgingReportSection() {
  const [data, setData] = useState<AgingPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get<AgingPayload>('/api/aging-report').then((res) => {
      if (cancelled) return
      if (res.success && res.data) setData(res.data)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function exportCsv() {
    if (!data) return
    downloadCsv(
      `aging-report-${todayStamp()}.csv`,
      ['Patient', 'Patient ID', '0-30', '31-60', '61-90', '90+', 'Total', 'Oldest Overdue'],
      data.rows.map((r) => [
        r.patientName,
        r.patientIdStr ?? '',
        formatAmount(Number(r.current)),
        formatAmount(Number(r.bucket30)),
        formatAmount(Number(r.bucket60)),
        formatAmount(Number(r.bucket90)),
        formatAmount(Number(r.total)),
        r.oldestOverdueDate ?? '',
      ])
    )
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!data) {
    return <p className="text-muted-foreground">Failed to load aging report.</p>
  }

  const { rows, summary, patientCount } = data

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {patientCount} patient{patientCount === 1 ? '' : 's'} with outstanding balance.
        </p>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="0–30 days" amount={summary.current} />
        <SummaryCard label="31–60 days" amount={summary.bucket30} tone="warning" />
        <SummaryCard label="61–90 days" amount={summary.bucket60} tone="warning" />
        <SummaryCard label="90+ days" amount={summary.bucket90} tone="danger" />
        <SummaryCard label="Total" amount={summary.total} tone="primary" />
      </div>

      {/* Per-patient table */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <DollarSign className="h-8 w-8 text-emerald-500/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">All patients are settled. Nice work.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead className="text-right">0-30</TableHead>
                <TableHead className="text-right">31-60</TableHead>
                <TableHead className="text-right">61-90</TableHead>
                <TableHead className="text-right text-red-600">90+</TableHead>
                <TableHead className="text-right font-semibold">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.patientId}>
                  <TableCell>
                    <Link to={`/patients/${r.patientId}?tab=ledger`} className="hover:underline">
                      <span className="font-medium text-sm">{r.patientName}</span>
                      {r.patientIdStr && (
                        <span className="ml-2 text-xs text-muted-foreground font-mono">
                          {r.patientIdStr}
                        </span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {r.current > 0 ? `GHS ${formatAmount(Number(r.current))}` : '—'}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {r.bucket30 > 0 ? `GHS ${formatAmount(Number(r.bucket30))}` : '—'}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {r.bucket60 > 0 ? `GHS ${formatAmount(Number(r.bucket60))}` : '—'}
                  </TableCell>
                  <TableCell className="text-right text-sm text-red-600 font-medium">
                    {r.bucket90 > 0 ? `GHS ${formatAmount(Number(r.bucket90))}` : '—'}
                  </TableCell>
                  <TableCell className="text-right text-sm font-bold">
                    GHS {formatAmount(Number(r.total))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  amount,
  tone,
}: {
  label: string
  amount: number
  tone?: 'warning' | 'danger' | 'primary'
}) {
  const color =
    tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-foreground'
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </p>
      <p className={`text-lg font-bold mt-0.5 ${color}`} title={formatCurrency(amount)}>
        {formatCurrencyCompact(amount)}
      </p>
    </div>
  )
}
