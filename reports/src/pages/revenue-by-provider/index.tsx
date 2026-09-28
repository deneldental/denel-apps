import { useCallback, useMemo, useState } from 'react'
import { ReportBarChart, ReportPieChart } from '@/components/report-charts'
import { fmt, ReportPage } from '@/components/report-page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useFinanceVisibility } from '@/hooks/useFinanceVisibility'
import { useReport } from '@/hooks/useReport'
import { getRevenueByProvider, type RevenueByProviderReport } from '@/lib/actions/phase8-reports'
import { startOfMonthIso, todayIso } from '@/lib/report-dates'

type GroupBy = 'provider' | 'specialist'

export default function RevenueByProviderPage() {
  const [from, setFrom] = useState(startOfMonthIso)
  const [to, setTo] = useState(todayIso)
  const [by, setBy] = useState<GroupBy>('provider')
  const visibility = useFinanceVisibility()

  const fetcher = useCallback(() => getRevenueByProvider(from, to, by), [from, to, by])
  const report = useReport<RevenueByProviderReport>(fetcher)

  return (
    <ReportPage
      title={`Revenue by ${by}`}
      description={`Sum of \`invoice_lines.line_total\` across non-archived issued invoices in the period, grouped by the line's ${by}.`}
      report={report}
      dateControls={[
        { id: 'rp-from', label: 'From', value: from, onChange: setFrom },
        { id: 'rp-to', label: 'To', value: to, onChange: setTo },
      ]}
      controls={
        <Tabs value={by} onValueChange={(v) => setBy(v as GroupBy)}>
          <TabsList>
            <TabsTrigger value="provider">By provider</TabsTrigger>
            <TabsTrigger value="specialist">By specialist</TabsTrigger>
          </TabsList>
        </Tabs>
      }
      isEmpty={(data) => data.rows.length === 0}
      emptyMessage={`No revenue grouped by ${by} in this range.`}
    >
      {(data) => (
        <RevenueByProviderContent data={data} by={by} showChart={visibility.showRevenue} />
      )}
    </ReportPage>
  )
}

function RevenueByProviderContent({
  data,
  by,
  showChart,
}: {
  data: RevenueByProviderReport
  by: GroupBy
  showChart: boolean
}) {
  const chartData = useMemo(
    () => data.rows.map((r) => ({ label: r.name, value: r.revenue })),
    [data.rows]
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardDescription>Total revenue</CardDescription>
          <CardTitle className="text-3xl font-mono text-emerald-600">{fmt(data.total)}</CardTitle>
        </CardHeader>
      </Card>

      {showChart && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Revenue per {by === 'specialist' ? 'specialist' : 'provider'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ReportBarChart data={chartData} color="#10b981" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Share of total</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportPieChart data={chartData} />
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{by === 'specialist' ? 'Specialist' : 'Provider'}</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r, idx) => {
                const share = data.total > 0 ? (r.revenue / data.total) * 100 : 0
                return (
                  // `id` is `string | null` — a composite key avoids a React
                  // key collision when more than one row has a null id (H26).
                  <TableRow key={`${r.id ?? 'none'}-${idx}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">{r.lineCount}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(r.revenue)}</TableCell>
                    <TableCell className="text-right text-sm">{share.toFixed(1)}%</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
