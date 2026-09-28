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
import { useFinanceVisibility } from '@/hooks/useFinanceVisibility'
import { useReport } from '@/hooks/useReport'
import { getRevenueByCategory, type RevenueByCategoryReport } from '@/lib/actions/phase8-reports'
import { startOfMonthIso, todayIso } from '@/lib/report-dates'

export default function RevenueByCategoryPage() {
  const [from, setFrom] = useState(startOfMonthIso)
  const [to, setTo] = useState(todayIso)
  const visibility = useFinanceVisibility()

  const fetcher = useCallback(() => getRevenueByCategory(from, to), [from, to])
  const report = useReport<RevenueByCategoryReport>(fetcher)

  return (
    <ReportPage
      title="Revenue by category"
      description="Net credit (income) per revenue account in the period."
      report={report}
      dateControls={[
        { id: 'rc-from', label: 'From', value: from, onChange: setFrom },
        { id: 'rc-to', label: 'To', value: to, onChange: setTo },
      ]}
      isEmpty={(data) => data.rows.length === 0}
      emptyMessage="No revenue recorded in this range."
    >
      {(data) => <RevenueByCategoryContent data={data} showChart={visibility.showRevenue} />}
    </ReportPage>
  )
}

function RevenueByCategoryContent({
  data,
  showChart,
}: {
  data: RevenueByCategoryReport
  showChart: boolean
}) {
  const chartData = useMemo(
    () => data.rows.map((r) => ({ label: r.accountName, value: r.amount })),
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
              <CardTitle className="text-base">Revenue per category</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportBarChart data={chartData} />
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
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Subtype</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => {
                const share = data.total > 0 ? (r.amount / data.total) * 100 : 0
                return (
                  <TableRow key={r.accountCode}>
                    <TableCell className="font-mono text-sm">{r.accountCode}</TableCell>
                    <TableCell>{r.accountName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.subtype ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono">{fmt(r.amount)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {share > 0 ? `${share.toFixed(1)}%` : '—'}
                    </TableCell>
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
