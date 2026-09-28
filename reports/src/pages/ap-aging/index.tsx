import type { ColumnDef } from '@tanstack/react-table'
import { useCallback, useMemo, useState } from 'react'
import { ReportBarChart } from '@/components/report-charts'
import { ReportDataTable } from '@/components/report-data-table'
import { fmt, ReportPage } from '@/components/report-page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useFinanceVisibility } from '@/hooks/useFinanceVisibility'
import { useReport } from '@/hooks/useReport'
import { type ApAgingReport, type ApAgingRow, getApAging } from '@/lib/actions/ap-aging'
import { formatReportDate, todayIso } from '@/lib/report-dates'

const columns: ColumnDef<ApAgingRow, unknown>[] = [
  { accessorKey: 'supplierName', header: 'Supplier' },
  {
    accessorKey: 'billCount',
    header: 'Bills',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="text-right block">{row.original.billCount}</span>,
  },
  {
    accessorKey: 'current',
    header: 'Current',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="font-mono">{fmt(row.original.current)}</span>,
  },
  {
    accessorKey: 'bucket30',
    header: '31–60',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="font-mono">{fmt(row.original.bucket30)}</span>,
  },
  {
    accessorKey: 'bucket60',
    header: '61–90',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="font-mono">{fmt(row.original.bucket60)}</span>,
  },
  {
    accessorKey: 'bucket90',
    header: '90+',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="font-mono">{fmt(row.original.bucket90)}</span>,
  },
  {
    accessorKey: 'total',
    header: 'Total',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="font-mono font-semibold">{fmt(row.original.total)}</span>,
  },
  {
    accessorKey: 'oldestDue',
    header: 'Oldest due',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {formatReportDate(row.original.oldestDue)}
      </span>
    ),
  },
]

export default function ApAgingReportPage() {
  const [asOf, setAsOf] = useState(todayIso)
  const visibility = useFinanceVisibility()

  const fetcher = useCallback(() => getApAging(asOf), [asOf])
  const report = useReport<ApAgingReport>(fetcher)

  return (
    <ReportPage
      title="AP Aging"
      description="Open supplier bills bucketed by days past `due_date`. Mirror of the AR aging report."
      report={report}
      dateControls={[{ id: 'ap-asof', label: 'As of', value: asOf, onChange: setAsOf }]}
    >
      {(data) => <ApAgingContent data={data} showChart={visibility.showAgingReport} />}
    </ReportPage>
  )
}

function ApAgingContent({ data, showChart }: { data: ApAgingReport; showChart: boolean }) {
  const bucketChart = useMemo(
    () => [
      { label: 'Current (0–30)', value: data.summary.current },
      { label: '31–60 days', value: data.summary.bucket30 },
      { label: '61–90 days', value: data.summary.bucket60 },
      { label: '90+ days', value: data.summary.bucket90 },
    ],
    [data.summary]
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-5">
        {[
          { label: 'Current (0–30)', value: data.summary.current },
          { label: '31–60 days', value: data.summary.bucket30 },
          { label: '61–90 days', value: data.summary.bucket60 },
          { label: '90+ days', value: data.summary.bucket90 },
          { label: 'Total owed', value: data.summary.total },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-2xl font-mono">{fmt(s.value)}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {showChart && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Outstanding by age bucket</CardTitle>
          </CardHeader>
          <CardContent>
            <ReportBarChart data={bucketChart} color="#f59e0b" />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per supplier</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportDataTable
            columns={columns}
            data={data.rows}
            emptyMessage="No suppliers with outstanding bills."
          />
        </CardContent>
      </Card>
    </div>
  )
}
