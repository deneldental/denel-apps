import { useCallback, useMemo, useState } from 'react'
import { ReportWaterfallChart } from '@/components/report-charts'
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
import { type CashFlowReport, getCashFlow } from '@/lib/actions/phase8-reports'
import { startOfMonthIso, todayIso } from '@/lib/report-dates'

export default function CashFlowPage() {
  const [from, setFrom] = useState(startOfMonthIso)
  const [to, setTo] = useState(todayIso)
  const visibility = useFinanceVisibility()

  const fetcher = useCallback(() => getCashFlow(from, to), [from, to])
  const report = useReport<CashFlowReport>(fetcher)

  return (
    <ReportPage
      title="Cash flow"
      description="Cash movements classified by source document type. Positive = inflow, negative = outflow."
      report={report}
      dateControls={[
        { id: 'cf-from', label: 'From', value: from, onChange: setFrom },
        { id: 'cf-to', label: 'To', value: to, onChange: setTo },
      ]}
    >
      {(data) => <CashFlowContent data={data} showChart={visibility.showRevenue} />}
    </ReportPage>
  )
}

function CashFlowContent({ data, showChart }: { data: CashFlowReport; showChart: boolean }) {
  const sections = [
    { title: 'Operating activities', rows: data.operating, total: data.totals.operating },
    { title: 'Investing activities', rows: data.investing, total: data.totals.investing },
    { title: 'Financing activities', rows: data.financing, total: data.totals.financing },
  ]

  // Waterfall: opening → ±operating → ±investing → ±financing → closing.
  const waterfallSteps = useMemo(
    () => [
      { label: 'Operating', delta: data.totals.operating },
      { label: 'Investing', delta: data.totals.investing },
      { label: 'Financing', delta: data.totals.financing },
    ],
    [data.totals]
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Opening cash</CardDescription>
            <CardTitle className="text-2xl font-mono">{fmt(data.openingCash)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Net change</CardDescription>
            <CardTitle
              className={`text-2xl font-mono ${
                data.netChange >= 0 ? 'text-emerald-600' : 'text-red-600'
              }`}
            >
              {fmt(data.netChange)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Closing cash</CardDescription>
            <CardTitle className="text-2xl font-mono">{fmt(data.closingCash)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {showChart && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cash movement</CardTitle>
            <CardDescription>Opening balance bridged to closing by activity.</CardDescription>
          </CardHeader>
          <CardContent>
            <ReportWaterfallChart opening={data.openingCash} steps={waterfallSteps} />
          </CardContent>
        </Card>
      )}

      {sections.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle className="text-base">{section.title}</CardTitle>
          </CardHeader>
          <CardContent>
            {section.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity in this category.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.rows.map((r) => (
                    <TableRow key={r.sourceDocType}>
                      <TableCell>{r.sourceDocType}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(r.net)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold border-t">
                    <TableCell>Subtotal</TableCell>
                    <TableCell className="text-right font-mono">{fmt(section.total)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
