import { TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import type { Expense } from '@/features/expenses/pages/columns'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

interface TopExpensesCardProps {
  expenses: Expense[]
  /** Max categories to show. Defaults to 5. */
  limit?: number
}

import { formatCurrency } from '@/shared/utils/currency'

/**
 * Admin-only summary card that highlights which categories are consuming the
 * most. Groups the expenses prop client-side — no extra network round-trip.
 * Caller is responsible for the admin gate.
 */
export function TopExpensesCard({ expenses, limit = 5 }: TopExpensesCardProps) {
  const { topCategories, grandTotal } = useMemo(() => {
    const totals = new Map<string, number>()
    let total = 0
    for (const e of expenses) {
      const amount = Number(e.amount) || 0
      const key = e.category || 'uncategorized'
      totals.set(key, (totals.get(key) ?? 0) + amount)
      total += amount
    }
    const sorted = [...totals.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit)
    return { topCategories: sorted, grandTotal: total }
  }, [expenses, limit])

  if (topCategories.length === 0) return null

  const topAmount = topCategories[0]?.amount ?? 0

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Top Expense Categories
          </CardTitle>
          <CardDescription>
            Where the clinic is spending the most across the current view
          </CardDescription>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium text-muted-foreground">Total</p>
          <p className="text-lg font-semibold">{formatCurrency(grandTotal)}</p>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {topCategories.map(({ category, amount }) => {
            const pctOfTotal = grandTotal > 0 ? (amount / grandTotal) * 100 : 0
            const barWidth = topAmount > 0 ? (amount / topAmount) * 100 : 0
            return (
              <li key={category} className="space-y-1">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="font-medium capitalize truncate">{category}</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    <span className="text-muted-foreground text-xs">
                      {Number(pctOfTotal).toFixed(1)}%
                    </span>
                    <span className="font-semibold">{formatCurrency(amount)}</span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
