import { useCallback, useState } from 'react'
import { fmt, ReportEmptyState, ReportPage } from '@/components/report-page'
import { Badge } from '@/components/ui/badge'
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
import {
  type BalanceSheetReport,
  getBalanceSheet,
  type ReportRow,
} from '@/lib/actions/financial-reports'
import { todayIso } from '@/lib/report-dates'

export default function BalanceSheetPage() {
  const [asOf, setAsOf] = useState(todayIso)

  const fetcher = useCallback(() => getBalanceSheet(asOf), [asOf])
  const report = useReport<BalanceSheetReport>(fetcher)

  return (
    <ReportPage
      title="Balance Sheet"
      description="Cumulative account balances as of a given date. Assets should equal Liabilities + Equity — any imbalance signals a data-integrity issue."
      report={report}
      dateControls={[{ id: 'bs-asof', label: 'As of', value: asOf, onChange: setAsOf }]}
    >
      {(data) => (
        <>
          {!data.isBalanced && (
            <Card className="border-red-500">
              <CardHeader>
                <CardTitle className="text-red-600">Imbalance detected</CardTitle>
                <CardDescription>
                  Assets − (Liabilities + Equity) = {fmt(data.imbalance)}. Run the reconciliation
                  health check from the portal to locate the drift.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Section title="Assets" rows={data.assets} total={data.totalAssets} />
            <Section title="Liabilities" rows={data.liabilities} total={data.totalLiabilities} />
            <Section title="Equity" rows={data.equity} total={data.totalEquity} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Accounting equation</CardTitle>
              <CardDescription>
                Assets = Liabilities + Equity{' '}
                {data.isBalanced ? (
                  <Badge>balanced</Badge>
                ) : (
                  <Badge variant="destructive">imbalanced</Badge>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-mono">
                {fmt(data.totalAssets)} = {fmt(data.totalLiabilities)} + {fmt(data.totalEquity)}
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </ReportPage>
  )
}

function Section({ title, rows, total }: { title: string; rows: ReportRow[]; total: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <ReportEmptyState message={`No ${title.toLowerCase()} accounts with a balance.`} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.accountId}>
                  <TableCell className="font-mono text-sm">{r.accountCode}</TableCell>
                  <TableCell>{r.accountName}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold border-t">
                <TableCell colSpan={2}>Total {title}</TableCell>
                <TableCell className="text-right font-mono">{fmt(total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
