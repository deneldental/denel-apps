import { Download } from 'lucide-react'
import type { PaymentPlansSummaryData } from '@/lib/actions/financial-analytics'
import { Button } from '@/shared/components/ui/button'
import { downloadCsv, todayStamp } from '@/shared/utils/csv'
import { GHS, LoadingSkeleton, SectionCard } from './shared'

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> =
  {
    activated: {
      label: 'Active',
      color: 'text-blue-700',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
    },
    completed: {
      label: 'Completed',
      color: 'text-green-700',
      bg: 'bg-green-50',
      border: 'border-green-200',
    },
    overdue: {
      label: 'Overdue',
      color: 'text-red-700',
      bg: 'bg-red-50',
      border: 'border-red-200',
    },
    outstanding: {
      label: 'Outstanding',
      color: 'text-amber-700',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
    },
    paused: {
      label: 'Paused',
      color: 'text-gray-600',
      bg: 'bg-gray-50',
      border: 'border-gray-200',
    },
  }

interface Props {
  plans: PaymentPlansSummaryData | null
}

export function FinancialPaymentPlansTab({ plans }: Props) {
  if (!plans) return <LoadingSkeleton />
  const { summary, totals } = plans
  const pendingAmount = totals.active_amount + totals.overdue_amount + totals.outstanding_amount
  const totalTracked = pendingAmount + totals.completed_amount
  const completedPct =
    totalTracked > 0 ? Math.round((totals.completed_amount / totalTracked) * 100) : 0

  function exportCsv() {
    downloadCsv(
      `payment-plans-${todayStamp()}.csv`,
      ['Status', 'Count', 'Total Amount'],
      summary.map((s) => [s.status, s.count, s.total_amount])
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end print:hidden">
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Status breakdown cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {summary.map((row) => {
          const cfg = STATUS_CONFIG[row.status] ?? {
            label: row.status,
            color: 'text-foreground',
            bg: 'bg-muted',
            border: 'border-border',
          }
          return (
            <div key={row.status} className={`rounded-lg border p-3 ${cfg.bg} ${cfg.border}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${cfg.color}`}>
                {cfg.label}
              </p>
              <p className={`text-2xl font-bold mt-1 ${cfg.color}`}>{row.count}</p>
              <p className={`text-xs mt-0.5 ${cfg.color} opacity-80`}>{GHS(row.total_amount)}</p>
            </div>
          )
        })}
      </div>

      {/* Balance summary */}
      <SectionCard title="Balance Overview">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Plans</span>
            <span className="font-medium">{totals.total_plans}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Pending Collection</span>
            <span className="font-medium text-amber-700">{GHS(pendingAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Collected</span>
            <span className="font-medium text-green-700">{GHS(totals.completed_amount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Overdue Amount</span>
            <span className="font-medium text-red-700">{GHS(totals.overdue_amount)}</span>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Collection progress</span>
            <span>{completedPct}% collected</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all"
              style={{ width: `${completedPct}%` }}
            />
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
