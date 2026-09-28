import type { ColumnDef } from '@tanstack/react-table'
import { useCallback, useState } from 'react'
import { ReportDataTable } from '@/components/report-data-table'
import { fmt, ReportPage } from '@/components/report-page'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useReport } from '@/hooks/useReport'
import {
  type CreditNoteDiscountRow,
  type DiscountsReport,
  getDiscountsReport,
  type LineDiscountRow,
} from '@/lib/actions/discounts-report'
import { formatReportDate, startOfMonthIso, todayIso } from '@/lib/report-dates'

const lineColumns: ColumnDef<LineDiscountRow, unknown>[] = [
  {
    accessorKey: 'issueDate',
    header: 'Date',
    cell: ({ row }) => <span className="text-sm">{formatReportDate(row.original.issueDate)}</span>,
  },
  {
    accessorKey: 'invoiceNumber',
    header: 'Invoice',
    cell: ({ row }) => <span className="font-mono text-sm">{row.original.invoiceNumber}</span>,
  },
  {
    accessorKey: 'reason',
    header: 'Reason',
    cell: ({ row }) => <span className="text-sm">{row.original.reason ?? '—'}</span>,
  },
  {
    accessorKey: 'providerName',
    header: 'Provider',
    cell: ({ row }) => <span className="text-sm">{row.original.providerName ?? '—'}</span>,
  },
  {
    accessorKey: 'authorizerName',
    header: 'Authorised by',
    cell: ({ row }) => <span className="text-sm">{row.original.authorizerName ?? '—'}</span>,
  },
  {
    accessorKey: 'amount',
    header: 'Amount',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="font-mono">{fmt(row.original.amount)}</span>,
  },
]

const creditNoteColumns: ColumnDef<CreditNoteDiscountRow, unknown>[] = [
  {
    accessorKey: 'issueDate',
    header: 'Date',
    cell: ({ row }) => <span className="text-sm">{formatReportDate(row.original.issueDate)}</span>,
  },
  {
    accessorKey: 'creditNoteNumber',
    header: 'Credit note',
    cell: ({ row }) => <span className="font-mono text-sm">{row.original.creditNoteNumber}</span>,
  },
  {
    accessorKey: 'invoiceNumber',
    header: 'Against invoice',
    cell: ({ row }) => <span className="font-mono text-sm">{row.original.invoiceNumber}</span>,
  },
  {
    accessorKey: 'reason',
    header: 'Reason',
    cell: ({ row }) => <span className="text-sm">{row.original.reason ?? '—'}</span>,
  },
  {
    accessorKey: 'authorizerName',
    header: 'Approved by',
    cell: ({ row }) => <span className="text-sm">{row.original.authorizerName ?? '—'}</span>,
  },
  {
    accessorKey: 'amount',
    header: 'Amount',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="font-mono">{fmt(row.original.amount)}</span>,
  },
]

export default function DiscountsReportPage() {
  const [from, setFrom] = useState(startOfMonthIso)
  const [to, setTo] = useState(todayIso)

  const fetcher = useCallback(() => getDiscountsReport(from, to), [from, to])
  const report = useReport<DiscountsReport>(fetcher)

  return (
    <ReportPage
      title="Discounts"
      description="All discounts given during the period — line-level (recorded at invoice issue) and post-issue credit notes with reason `discount`. Authoriser / provider columns flag who granted the discount."
      report={report}
      dateControls={[
        { id: 'dr-from', label: 'From', value: from, onChange: setFrom },
        { id: 'dr-to', label: 'To', value: to, onChange: setTo },
      ]}
    >
      {(data) => (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Line-level discounts</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold font-mono">{fmt(data.totals.lineDiscounts)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.lineDiscounts.length} invoice line(s)
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Credit-note discounts</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold font-mono">
                  {fmt(data.totals.creditNoteDiscounts)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.creditNoteDiscounts.length} credit note(s)
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Total given</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold font-mono text-emerald-600">
                  {fmt(data.totals.total)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line-level (at invoice issue)</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportDataTable
                columns={lineColumns}
                data={data.lineDiscounts}
                emptyMessage="No line discounts in this range."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Post-issue credit notes</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportDataTable
                columns={creditNoteColumns}
                data={data.creditNoteDiscounts}
                emptyMessage="No credit-note discounts in this range."
              />
            </CardContent>
          </Card>
        </>
      )}
    </ReportPage>
  )
}
