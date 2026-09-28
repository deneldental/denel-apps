import { Button, Card, CardContent, CardHeader, CardTitle } from '@denel/ui'
import { formatCurrency } from '@denel/utils'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Loader2, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { PayrollRun, PayrollRunDetailRow } from '@/lib/actions/hr-phase2-4'
import { API_BASE_URL } from '@/lib/api-client'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { StatusBadge } from '@/shared/components/status-badge'

interface PayrollRunLedgerProps {
  run: PayrollRun
  rows: PayrollRunDetailRow[]
  loading?: boolean
}

/**
 * Integer CENTS in — the `/runs/:id/ledger` payload normalises every leg to
 * cents, including the ones it reads out of the cedis-denominated `deductions`
 * JSONB. Em dash for a missing value.
 */
function formatGhs(value: number | null | undefined): string {
  if (value == null) return '—'
  return formatCurrency(value)
}

function formatDate(input: string | null | undefined): string {
  if (!input) return '—'
  try {
    return format(input, 'MMM d, yyyy')
  } catch {
    return input
  }
}

const NUMERIC_KEYS: Array<keyof PayrollRunDetailRow> = [
  'basicSalary',
  'allowances',
  'overtime',
  'grossPay',
  'paye',
  'ssnitTier1',
  'ssnitTier2',
  'netPay',
  'totalEmployerCost',
]

const COLUMN_LABELS: Record<keyof PayrollRunDetailRow, string> = {
  id: 'ID',
  staffId: 'Staff ID',
  staffName: 'Staff Name',
  staffCode: 'Staff Code',
  basicSalary: 'Basic Salary',
  allowances: 'Allowances',
  overtime: 'Overtime',
  grossPay: 'Gross Pay',
  netPay: 'Net Pay',
  paye: 'PAYE (GRA)',
  ssnitTier1: 'SSNIT Tier 1',
  ssnitTier2: 'SSNIT Tier 2',
  totalEmployerCost: 'Total Employer Cost',
}

export function PayrollRunLedger({ run, rows, loading }: PayrollRunLedgerProps) {
  const totals = useMemo(() => {
    return NUMERIC_KEYS.reduce(
      (acc, key) => {
        acc[key] = rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0)
        return acc
      },
      {} as Record<(typeof NUMERIC_KEYS)[number], number>
    )
  }, [rows])

  const columns = useMemo<ColumnDef<PayrollRunDetailRow>[]>(
    () => [
      {
        accessorKey: 'staffName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Staff Name" />,
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-sm">{row.original.staffName ?? '(Unknown staff)'}</p>
            {row.original.staffCode && (
              <p className="text-xs text-muted-foreground">{row.original.staffCode}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'basicSalary',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Basic Salary" className="justify-end" />
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {formatGhs(row.original.basicSalary)}
          </span>
        ),
      },
      {
        accessorKey: 'allowances',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Allowances" className="justify-end" />
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {formatGhs(row.original.allowances)}
          </span>
        ),
      },
      {
        accessorKey: 'overtime',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Overtime" className="justify-end" />
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">{formatGhs(row.original.overtime)}</span>
        ),
      },
      {
        accessorKey: 'grossPay',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Gross Pay" className="justify-end" />
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums font-medium">
            {formatGhs(row.original.grossPay)}
          </span>
        ),
      },
      {
        accessorKey: 'paye',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="PAYE (GRA)" className="justify-end" />
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">{formatGhs(row.original.paye)}</span>
        ),
      },
      {
        accessorKey: 'ssnitTier1',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="SSNIT Tier 1" className="justify-end" />
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {formatGhs(row.original.ssnitTier1)}
          </span>
        ),
      },
      {
        accessorKey: 'ssnitTier2',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="SSNIT Tier 2" className="justify-end" />
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {formatGhs(row.original.ssnitTier2)}
          </span>
        ),
      },
      {
        accessorKey: 'netPay',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Net Pay" className="justify-end" />
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
            {formatGhs(row.original.netPay)}
          </span>
        ),
      },
      {
        accessorKey: 'totalEmployerCost',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Total Employer Cost"
            className="justify-end"
          />
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums font-medium">
            {formatGhs(row.original.totalEmployerCost)}
          </span>
        ),
      },
    ],
    []
  )

  const [downloading, setDownloading] = useState(false)
  const handlePrint = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/payroll/runs/${run.id}/pdf`, {
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Failed to generate PDF')
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = `Payroll_Run_${run.name.replace(/\s+/g, '_')}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
      alert('Failed to download PDF')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">{run.name}</h3>
          <p className="text-sm text-muted-foreground">
            {formatDate(run.payPeriodStart)} – {formatDate(run.payPeriodEnd)}
          </p>
          <div className="mt-2">
            <StatusBadge status={run.status} />
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrint}
          disabled={loading || rows.length === 0}
          className="shrink-0"
        >
          {downloading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Printer className="mr-2 h-4 w-4" />
          )}
          {downloading ? 'Generating PDF...' : 'Print / Download Ledger'}
        </Button>
      </div>

      <Card className="">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Column totals</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-16 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {NUMERIC_KEYS.map((key) => (
                <div key={key} className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {COLUMN_LABELS[key]}
                  </p>
                  <p className="text-sm font-semibold tabular-nums">{formatGhs(totals[key])}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <div className="mb-4">
          <h1 className="text-2xl font-bold">{run.name}</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(run.payPeriodStart)} – {formatDate(run.payPeriodEnd)}
          </p>
          <div className="mt-1">
            <StatusBadge status={run.status} />
          </div>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-900">
              <th className="py-1.5 pr-2 text-left font-semibold uppercase tracking-wide">
                Staff Name
              </th>
              <th className="py-1.5 px-2 text-right font-semibold uppercase tracking-wide">
                Basic
              </th>
              <th className="py-1.5 px-2 text-right font-semibold uppercase tracking-wide">
                Allow.
              </th>
              <th className="py-1.5 px-2 text-right font-semibold uppercase tracking-wide">
                Gross
              </th>
              <th className="py-1.5 px-2 text-right font-semibold uppercase tracking-wide">PAYE</th>
              <th className="py-1.5 px-2 text-right font-semibold uppercase tracking-wide">
                Tier 1
              </th>
              <th className="py-1.5 px-2 text-right font-semibold uppercase tracking-wide">
                Tier 2
              </th>
              <th className="py-1.5 px-2 text-right font-semibold uppercase tracking-wide">Net</th>
              <th className="py-1.5 pl-2 text-right font-semibold uppercase tracking-wide">
                Employer Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-2">
                  <span className="font-medium">{row.staffName ?? '(Unknown)'}</span>
                  {row.staffCode && (
                    <span className="block text-xs text-slate-500">{row.staffCode}</span>
                  )}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  {formatGhs(row.basicSalary)}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">{formatGhs(row.allowances)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums font-medium">
                  {formatGhs(row.grossPay)}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">{formatGhs(row.paye)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{formatGhs(row.ssnitTier1)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{formatGhs(row.ssnitTier2)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums font-semibold">
                  {formatGhs(row.netPay)}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums">
                  {formatGhs(row.totalEmployerCost)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-900">
              <td className="py-2 pr-2 font-semibold uppercase">Total</td>
              {NUMERIC_KEYS.map((key) => (
                <td key={key} className="py-2 px-2 text-right font-semibold tabular-nums">
                  {formatGhs(totals[key])}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <div>
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <DataTable columns={columns} data={rows} />
        )}
      </div>
    </div>
  )
}

PayrollRunLedger.displayName = 'PayrollRunLedger'
