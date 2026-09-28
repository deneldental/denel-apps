import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { formatAmount } from '@/shared/utils/currency'

// Shared colour palettes + helpers used across the financial analytics tabs.
// Kept in one place so chart colours stay consistent across Overview / Revenue
// / Expenses / Payment Plans / Year-over-Year.

export const TREATMENT_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#16a34a',
  '#0891b2',
  '#9333ea',
  '#dc2626',
]

export const EXPENSE_COLORS = [
  '#f97316',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]

export const METHOD_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

export const GHS = (n: number) => `GHS ${formatAmount(n)}`

export const CUSTOM_TOOLTIP_STYLE = { fontSize: 12, borderRadius: 6 }

export function GrowthBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted-foreground">—</span>
  if (value > 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600">
        <TrendingUp className="h-3 w-3" />+{value}%
      </span>
    )
  if (value < 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-500">
        <TrendingDown className="h-3 w-3" />
        {value}%
      </span>
    )
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
      <Minus className="h-3 w-3" />
      0%
    </span>
  )
}

export function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4 print:border-gray-300">
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </div>
  )
}

export function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-lg" />
      <div className="grid md:grid-cols-2 gap-4">
        <Skeleton className="h-56 rounded-lg" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
    </div>
  )
}

// ─── Annual rollup helpers (merge quarterly data into yearly totals) ──────────

import type { AnalyticsData } from '@/lib/actions/analytics'

export function mergeAnnualTreatments(data: AnalyticsData) {
  const map: Record<string, { amount: number; count: number }> = {}
  for (const q of ['Q1', 'Q2', 'Q3', 'Q4'] as const) {
    for (const t of data[q].revenue.byTreatment) {
      if (!map[t.name]) map[t.name] = { amount: 0, count: 0 }
      map[t.name].amount += t.amount
    }
    for (const t of data[q].treatments) {
      if (!map[t.name]) map[t.name] = { amount: 0, count: 0 }
      map[t.name].count += t.count
    }
  }
  const total = Object.values(map).reduce((s, t) => s + t.amount, 0)
  return Object.entries(map)
    .map(([name, t]) => ({
      name,
      amount: Math.round(t.amount * 100) / 100,
      count: t.count,
      percentage: total > 0 ? Math.round((t.amount / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

export function mergeAnnualExpenses(data: AnalyticsData) {
  const map: Record<string, number> = {}
  for (const q of ['Q1', 'Q2', 'Q3', 'Q4'] as const) {
    for (const e of data[q].expenses.byCategory) {
      map[e.category] = (map[e.category] ?? 0) + e.amount
    }
  }
  const total = Object.values(map).reduce((s, v) => s + v, 0)
  return Object.entries(map)
    .map(([category, amount]) => ({
      category,
      amount: Math.round(amount * 100) / 100,
      percentage: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

export function mergeAnnualPaymentMethods(data: AnalyticsData) {
  const map: Record<string, { count: number; amount: number }> = {}
  for (const q of ['Q1', 'Q2', 'Q3', 'Q4'] as const) {
    for (const m of data[q].paymentMethods) {
      if (!map[m.method]) map[m.method] = { count: 0, amount: 0 }
      map[m.method].count += m.count
      map[m.method].amount += m.amount
    }
  }
  const totalCount = Object.values(map).reduce((s, m) => s + m.count, 0)
  return Object.entries(map)
    .map(([method, m]) => ({
      method,
      count: m.count,
      amount: Math.round(m.amount * 100) / 100,
      percentage: totalCount > 0 ? Math.round((m.count / totalCount) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)
}
