import type { ColumnDef } from '@tanstack/react-table'
import { useCallback, useMemo, useState } from 'react'
import { ReportDataTable } from '@/components/report-data-table'
import { fmt, ReportPage } from '@/components/report-page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useReport } from '@/hooks/useReport'
import { type DeferredRevenueLine, listDeferredLines } from '@/lib/actions/deferred-revenue'

type Mode = 'outstanding' | 'all'

const columns: ColumnDef<DeferredRevenueLine, unknown>[] = [
  {
    accessorKey: 'invoiceNumber',
    header: 'Invoice',
    cell: ({ row }) => <span className="font-mono text-sm">{row.original.invoiceNumber}</span>,
  },
  {
    accessorKey: 'description',
    header: 'Description',
    cell: ({ row }) => <span className="text-sm">{row.original.description}</span>,
  },
  {
    id: 'revenueAccount',
    header: 'Revenue account',
    cell: ({ row }) => (
      <span className="text-xs font-mono text-muted-foreground">
        {row.original.revenueAccountCode} — {row.original.revenueAccountName}
      </span>
    ),
  },
  {
    accessorKey: 'lineAfterDiscount',
    header: 'Line total',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="font-mono">{fmt(row.original.lineAfterDiscount)}</span>,
  },
  {
    accessorKey: 'recognizedAmount',
    header: 'Recognised',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="font-mono">{fmt(row.original.recognizedAmount)}</span>,
  },
  {
    accessorKey: 'remainingDeferred',
    header: 'Remaining',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="font-mono font-semibold">{fmt(row.original.remainingDeferred)}</span>
    ),
  },
]

export default function DeferredRevenueReportPage() {
  const [mode, setMode] = useState<Mode>('outstanding')

  const fetcher = useCallback(
    () => listDeferredLines({ outstandingOnly: mode === 'outstanding' }),
    [mode]
  )
  const report = useReport<DeferredRevenueLine[]>(fetcher)

  return (
    <ReportPage
      title="Deferred revenue"
      description="Lines posted to 2400 Deferred Revenue at issue. Remaining = original line amount − recognised events."
      report={report}
      controls={
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="outstanding">Outstanding</TabsTrigger>
            <TabsTrigger value="all">All deferred lines</TabsTrigger>
          </TabsList>
        </Tabs>
      }
    >
      {(data) => <DeferredRevenueContent data={data} mode={mode} />}
    </ReportPage>
  )
}

function DeferredRevenueContent({ data, mode }: { data: DeferredRevenueLine[]; mode: Mode }) {
  const summary = useMemo(
    () =>
      data.reduce(
        (acc, r) => ({
          total: acc.total + r.lineAfterDiscount,
          recognised: acc.recognised + r.recognizedAmount,
          remaining: acc.remaining + r.remainingDeferred,
        }),
        { total: 0, recognised: 0, remaining: 0 }
      ),
    [data]
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total invoiced</CardDescription>
            <CardTitle className="text-2xl font-mono">{fmt(summary.total)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Recognised</CardDescription>
            <CardTitle className="text-2xl font-mono text-emerald-600">
              {fmt(summary.recognised)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Remaining (= 2400 balance)</CardDescription>
            <CardTitle className="text-2xl font-mono">{fmt(summary.remaining)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per line</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportDataTable
            columns={columns}
            data={data}
            emptyMessage={`No ${mode === 'outstanding' ? 'outstanding ' : ''}deferred lines.`}
          />
        </CardContent>
      </Card>
    </div>
  )
}
