// TODO(backend-wiring): detail rendering operates on mock tier summaries.
// Replace `summary` prop with hydrated responses from
// /api/reports/{weekly,monthly,quarterly}/:id once the endpoints exist.

import { Printer } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatCurrency, formatCurrencyCompact } from '@/lib/utils'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/shared/components/ui/breadcrumb'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { ComparisonArrow } from './summary-comparison'

export interface PeriodTotals {
  revenue: number
  expenses: number
  payments: number
  insurance: number
  labs: number
  xrays: number
  productSales: number
}

export interface VsPrior {
  revenuePct: number
  expensesPct: number
  patientCountPct: number
}

export interface BreakdownRow {
  /** Stable key for the row (usually an ISO date). */
  key: string
  /** Display label, e.g. "Mon Apr 6" or "Week of Apr 6". */
  label: string
  /** Secondary line, e.g. the range or submitter. */
  subLabel?: string
  revenue: number
  patientCount: number
}

export interface PeriodDetailProps {
  /** Tier label in breadcrumb (e.g. "Weekly Summaries"). */
  tierLabel: string
  /** Route to the tier list (e.g. "/reports/weekly"). */
  tierHref: string
  /** Page-level period label (e.g. "Apr 6 – Apr 12, 2026"). */
  periodLabel: string
  /** Smaller supporting label (e.g. "Week 15 of 2026"). */
  periodSubLabel?: string
  totals: PeriodTotals
  vsPrior: VsPrior
  /** Label for the breakdown section subheading (e.g. "Daily breakdown"). */
  breakdownLabel: string
  /** Column header for the first column of the breakdown table. */
  breakdownHeader: string
  breakdown: BreakdownRow[]
}

const HERO_METRICS: Array<{ key: keyof PeriodTotals; label: string }> = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'payments', label: 'Payments' },
  { key: 'insurance', label: 'Insurance' },
]

const SECONDARY_METRICS: Array<{ key: keyof PeriodTotals; label: string }> = [
  { key: 'labs', label: 'Labs' },
  { key: 'xrays', label: 'X-rays' },
  { key: 'productSales', label: 'Product Sales' },
]

export function PeriodDetail({
  tierLabel,
  tierHref,
  periodLabel,
  periodSubLabel,
  totals,
  vsPrior,
  breakdownLabel,
  breakdownHeader,
  breakdown,
}: PeriodDetailProps) {
  const net = totals.revenue - totals.expenses

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/reports">Reports</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={tierHref}>{tierLabel}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{periodLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Hero card with period range + grand totals (compact) */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl">{periodLabel}</CardTitle>
          {periodSubLabel ? (
            <p className="text-sm text-muted-foreground">{periodSubLabel}</p>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-4">
          {HERO_METRICS.map((m) => (
            <div key={m.key}>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</p>
              <p
                className="mt-1 text-3xl font-bold tracking-tight"
                title={formatCurrency(totals[m.key])}
              >
                {formatCurrencyCompact(totals[m.key])}
              </p>
            </div>
          ))}
          <div className="md:col-span-4 border-t pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Net</p>
            <p className="mt-1 text-2xl font-semibold" title={formatCurrency(net)}>
              {formatCurrencyCompact(net)}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Comparison ribbon */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-4">
          <span className="text-sm font-medium text-muted-foreground">vs prior period</span>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Revenue</span>
            <ComparisonArrow value={vsPrior.revenuePct} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Expenses</span>
            <ComparisonArrow value={vsPrior.expensesPct} invertColor />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Patients</span>
            <ComparisonArrow value={vsPrior.patientCountPct} />
          </div>
        </CardContent>
      </Card>

      {/* Revenue section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Revenue — {breakdownLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          {breakdown.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 font-medium">{breakdownHeader}</th>
                    <th className="py-2 font-medium">Patients</th>
                    <th className="py-2 text-right font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((row) => (
                    <tr key={row.key} className="border-b last:border-0">
                      <td className="py-2">
                        <div className="font-medium">{row.label}</div>
                        {row.subLabel ? (
                          <div className="text-xs text-muted-foreground">{row.subLabel}</div>
                        ) : null}
                      </td>
                      <td className="py-2">{row.patientCount}</td>
                      <td className="py-2 text-right font-medium">{formatCurrency(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Expenses section (shares the same sub-period breakdown — expense column) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline justify-between">
            <p className="text-sm text-muted-foreground">Total expenses for the period</p>
            <p className="text-2xl font-semibold" title={formatCurrency(totals.expenses)}>
              {formatCurrencyCompact(totals.expenses)}
            </p>
          </div>
          {/* TODO(backend-wiring): replace with per-sub-period expense rows
              from /api/reports/{tier}/:id/expenses once available. */}
          <p className="mt-2 text-xs text-muted-foreground">
            Detailed expense breakdown coming soon.
          </p>
        </CardContent>
      </Card>

      {/* Labs / Insurance / X-rays / Product Sales as compact stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SECONDARY_METRICS.map((m) => (
          <Card key={m.key}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</p>
              <p className="mt-1 text-2xl font-semibold" title={formatCurrency(totals[m.key])}>
                {formatCurrencyCompact(totals[m.key])}
              </p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Insurance</p>
            <p className="mt-1 text-2xl font-semibold" title={formatCurrency(totals.insurance)}>
              {formatCurrencyCompact(totals.insurance)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Print footer */}
      <div className="flex justify-end pt-2">
        <Button
          variant="outline"
          onClick={() => {
            if (typeof window !== 'undefined') window.print()
          }}
        >
          <Printer className="mr-2 h-4 w-4" />
          Print this report
        </Button>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed py-12 text-center">
      <div className="max-w-sm">
        <p className="font-medium">No data for this period</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Once daily reports are submitted for this period, the breakdown will appear here.
        </p>
      </div>
    </div>
  )
}
