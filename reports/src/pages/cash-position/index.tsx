import { useCallback, useState } from 'react'
import { fmt, ReportEmptyState, ReportPage } from '@/components/report-page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useReport } from '@/hooks/useReport'
import { type CashPositionReport, getCashPosition } from '@/lib/actions/phase8-reports'
import { startOfMonthIso, todayIso } from '@/lib/report-dates'

export default function CashPositionPage() {
  const [from, setFrom] = useState(startOfMonthIso)
  const [to, setTo] = useState(todayIso)

  const fetcher = useCallback(() => getCashPosition(from, to), [from, to])
  const report = useReport<CashPositionReport>(fetcher)

  return (
    <ReportPage
      title="Cash position"
      description="Opening, inflow, outflow, and closing balance per cash / bank / MoMo account. Use for daily till count and bank reconciliation."
      report={report}
      dateControls={[
        { id: 'cp-from', label: 'From', value: from, onChange: setFrom },
        { id: 'cp-to', label: 'To', value: to, onChange: setTo },
      ]}
    >
      {(data) => (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader>
                <CardDescription>Opening</CardDescription>
                <CardTitle className="text-2xl font-mono">{fmt(data.totals.opening)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Inflow</CardDescription>
                <CardTitle className="text-2xl font-mono text-emerald-600">
                  {fmt(data.totals.inflow)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Outflow</CardDescription>
                <CardTitle className="text-2xl font-mono text-red-600">
                  {fmt(data.totals.outflow)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Closing</CardDescription>
                <CardTitle className="text-2xl font-mono font-bold">
                  {fmt(data.totals.closing)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per channel</CardTitle>
            </CardHeader>
            <CardContent>
              {data.accounts.length === 0 ? (
                <ReportEmptyState message="No cash accounts seeded." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Code</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Opening</TableHead>
                      <TableHead className="text-right">Inflow</TableHead>
                      <TableHead className="text-right">Outflow</TableHead>
                      <TableHead className="text-right">Closing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.accounts.map((a) => (
                      <TableRow key={a.accountCode}>
                        <TableCell className="font-mono text-sm">{a.accountCode}</TableCell>
                        <TableCell>{a.accountName}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(a.opening)}</TableCell>
                        <TableCell className="text-right font-mono text-emerald-600">
                          {fmt(a.inflow)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-red-600">
                          {fmt(a.outflow)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {fmt(a.closing)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </ReportPage>
  )
}
