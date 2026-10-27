import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@denel/ui'
import { format, parseISO } from 'date-fns'
import { CalendarRange, Coins, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { disbursePayrollRun } from '@/lib/actions/hr-phase2-4'
import type { ApiResponse } from '@/lib/api-client'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { EmptyState } from '@/shared/components/empty-state'
import { useConfirm } from '@/shared/hooks/use-confirm'
import { formatCurrency } from '@/shared/utils/currency'

export interface PayrollRun {
  id: string
  name: string
  payPeriodStart: string
  payPeriodEnd: string
  status: 'draft' | 'published'
  staffCount: number
  totalGross: number
  totalNet: number
  totalPaye: number
  totalSsnit: number
  disbursedAt: string | null
}

function ghs(value: number | string | null): string {
  if (value == null) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return formatCurrency(n)
}

function formatDate(input: string | null | undefined): string {
  if (!input) return '—'
  try {
    return format(parseISO(input), 'MMM d, yyyy')
  } catch {
    return input
  }
}

const PAYROLL_RUNS_KEY = ['finance', 'payroll-runs'] as const

type PayrollRunsResponse = { data: PayrollRun[] } | PayrollRun[]

async function fetchPublishedPayrollRuns(): Promise<ApiResponse<PayrollRun[]>> {
  try {
    const res = await api.get<PayrollRunsResponse>('/api/payroll/runs')
    const payload = res.success ? res.data : undefined
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : null
    if (!rows) return { success: false, error: 'Failed to load pay runs' }
    // Finance only needs to see published runs
    return { success: true, data: rows.filter((r) => r.status === 'published') }
  } catch (_err) {
    return { success: false, error: 'An error occurred while loading payrolls' }
  }
}

export default function FinancePayrollPage() {
  const [disbursingId, setDisbursingId] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const runsQuery = useApiQuery(PAYROLL_RUNS_KEY, fetchPublishedPayrollRuns)
  const runs = runsQuery.data ?? []
  const loading = runsQuery.isLoading

  useEffect(() => {
    if (runsQuery.isError) toast.error(runsQuery.error.message)
  }, [runsQuery.isError, runsQuery.error])

  async function handleDisburse(run: PayrollRun) {
    if (
      !(await confirm({
        title: 'Disburse Payroll',
        description: `Are you sure you want to disburse "${run.name}"? This will clear Net Salaries Payable to Bank.`,
        confirmLabel: 'Disburse',
      }))
    )
      return
    setDisbursingId(run.id)
    try {
      const res = await disbursePayrollRun(run.id)
      if (res.success) {
        toast.success(`${run.name} disbursed — net pay cleared to bank.`)
        await runsQuery.refetch()
      } else {
        toast.error(res.error || 'Failed to disburse pay run')
      }
    } catch (_err) {
      toast.error('An error occurred during disbursal')
    } finally {
      setDisbursingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payroll Disbursal</h1>
          <p className="mt-1 text-muted-foreground">
            Review and disburse published payroll runs. Disbursal automatically generates Journal
            Entries and marks payslips as PAID.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Coins className="h-5 w-5" />
            Published Runs
          </CardTitle>
          <CardDescription>
            Only payrolls that have been finalized and published by HR appear here for payment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : runs.length === 0 ? (
            <EmptyState
              icon={Coins}
              title="No pending payrolls"
              description="There are no published payroll runs awaiting disbursal at this time."
            />
          ) : (
            <ul className="divide-y divide-border">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="grid grid-cols-1 gap-3 py-3 md:grid-cols-[1.5fr_1fr_1fr_1fr_auto] md:items-center"
                >
                  <div>
                    <p className="text-sm font-medium">{run.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <CalendarRange className="mr-1 inline h-3 w-3" />
                      {formatDate(run.payPeriodStart)} – {formatDate(run.payPeriodEnd)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Staff
                    </p>
                    <p className="text-sm tabular-nums">{run.staffCount}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Gross / Net
                    </p>
                    <p className="text-sm tabular-nums">{ghs(run.totalGross)}</p>
                    <p className="text-xs tabular-nums text-muted-foreground font-semibold text-emerald-600 dark:text-emerald-400">
                      {ghs(run.totalNet)} net
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      PAYE / SSNIT
                    </p>
                    <p className="text-sm tabular-nums">{ghs(run.totalPaye)}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {ghs(run.totalSsnit)} ssnit
                    </p>
                  </div>
                  <div className="flex items-center gap-3 md:justify-end">
                    <Badge variant={run.status === 'published' ? 'default' : 'secondary'}>
                      {run.status.toUpperCase()}
                    </Badge>
                    {!run.disbursedAt && (
                      <Button
                        size="sm"
                        onClick={() => handleDisburse(run)}
                        disabled={disbursingId === run.id}
                      >
                        {disbursingId === run.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Coins className="mr-2 h-4 w-4" />
                        )}
                        Confirm Payment
                      </Button>
                    )}
                    {run.disbursedAt && (
                      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <Coins className="h-3 w-3" />
                        Disbursed {formatDate(run.disbursedAt)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  )
}
