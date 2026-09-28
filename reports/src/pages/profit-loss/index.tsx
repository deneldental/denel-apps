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
import {
  getProfitLoss,
  type ProfitLossReport,
  type ReportRow,
} from '@/lib/actions/financial-reports'
import { startOfMonthIso, todayIso } from '@/lib/report-dates'

export default function ProfitLossPage() {
  const [from, setFrom] = useState(startOfMonthIso)
  const [to, setTo] = useState(todayIso)

  const fetcher = useCallback(() => getProfitLoss(from, to), [from, to])
  const report = useReport<ProfitLossReport>(fetcher)

  return (
    <ReportPage
      title="Profit & Loss"
      description="Revenue and expenses recorded in the General Ledger between two dates."
      report={report}
      dateControls={[
        { id: 'pl-from', label: 'From', value: from, onChange: setFrom },
        { id: 'pl-to', label: 'To', value: to, onChange: setTo },
      ]}
    >
      {(data) => (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Revenue</CardTitle>
              <CardDescription>Income earned in the period</CardDescription>
            </CardHeader>
            <CardContent>
              <AccountTable
                rows={data.revenue}
                total={data.totalRevenue}
                totalLabel="Total Revenue"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Expenses</CardTitle>
              <CardDescription>Costs incurred in the period</CardDescription>
            </CardHeader>
            <CardContent>
              <AccountTable
                rows={data.expenses}
                total={data.totalExpenses}
                totalLabel="Total Expenses"
              />
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Net Income</CardTitle>
              <CardDescription>
                Total Revenue ({fmt(data.totalRevenue)}) − Total Expenses ({fmt(data.totalExpenses)}
                )
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p
                className={`text-3xl font-bold font-mono ${
                  data.netIncome >= 0 ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                {fmt(data.netIncome)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </ReportPage>
  )
}

function AccountTable({
  rows,
  total,
  totalLabel,
}: {
  rows: ReportRow[]
  total: number
  totalLabel: string
}) {
  if (rows.length === 0) {
    return <ReportEmptyState message="No accounts with activity in this range." />
  }
  return (
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
          <TableCell colSpan={2}>{totalLabel}</TableCell>
          <TableCell className="text-right font-mono">{fmt(total)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
