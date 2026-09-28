import type { ColumnDef } from '@tanstack/react-table'
import { useCallback, useState } from 'react'
import { ReportDataTable } from '@/components/report-data-table'
import { fmt, ReportPage } from '@/components/report-page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useReport } from '@/hooks/useReport'
import {
  type CommissionReport,
  type CommissionReportRow,
  getSpecialistCommissionsReport,
} from '@/lib/actions/specialist-commissions'
import { startOfMonthIso, todayIso } from '@/lib/report-dates'

const columns: ColumnDef<CommissionReportRow, unknown>[] = [
  { accessorKey: 'specialistName', header: 'Specialist' },
  {
    accessorKey: 'commissionCount',
    header: '# Lines',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="text-right block">{row.original.commissionCount}</span>,
  },
  {
    accessorKey: 'accrued',
    header: 'Accrued',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="font-mono">{fmt(row.original.accrued)}</span>,
  },
  {
    accessorKey: 'payable',
    header: 'Payable',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="font-mono">{fmt(row.original.payable)}</span>,
  },
  {
    accessorKey: 'paid',
    header: 'Paid',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="font-mono">{fmt(row.original.paid)}</span>,
  },
  {
    accessorKey: 'reversed',
    header: 'Reversed',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="font-mono text-red-600">{fmt(row.original.reversed)}</span>,
  },
  {
    accessorKey: 'totalCommissioned',
    header: 'Total',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="font-mono font-semibold">{fmt(row.original.totalCommissioned)}</span>
    ),
  },
]

export default function SpecialistCommissionsReportPage() {
  const [from, setFrom] = useState(startOfMonthIso)
  const [to, setTo] = useState(todayIso)

  const fetcher = useCallback(() => getSpecialistCommissionsReport(from, to), [from, to])
  const report = useReport<CommissionReport>(fetcher)

  return (
    <ReportPage
      title="Specialist commissions"
      description="Per-specialist accrued / payable / paid totals for commissions accrued in the period. Payable transitions are proportional to invoice payments (spec §6.5)."
      report={report}
      dateControls={[
        { id: 'sc-from', label: 'From', value: from, onChange: setFrom },
        { id: 'sc-to', label: 'To', value: to, onChange: setTo },
      ]}
    >
      {(data) => (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            {[
              { label: 'Accrued', value: data.summary.accrued, hint: 'awaiting patient payment' },
              { label: 'Payable', value: data.summary.payable, hint: 'ready to pay out' },
              { label: 'Paid', value: data.summary.paid, hint: 'cash settled' },
              { label: 'Total commissioned', value: data.summary.totalCommissioned, hint: '' },
            ].map((s) => (
              <Card key={s.label}>
                <CardHeader>
                  <CardDescription>{s.label}</CardDescription>
                  <CardTitle className="text-2xl font-mono">{fmt(s.value)}</CardTitle>
                  {s.hint && <CardDescription className="text-xs">{s.hint}</CardDescription>}
                </CardHeader>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per specialist</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportDataTable
                columns={columns}
                data={data.rows}
                emptyMessage="No commissions accrued in this period."
              />
            </CardContent>
          </Card>
        </>
      )}
    </ReportPage>
  )
}
