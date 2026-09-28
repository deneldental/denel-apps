// Shared color palettes (mirror the analytics page) and small helpers used by
// all four PeriodReport sections. Keeping these in one place means all reports
// stay visually consistent with the analytics dashboard.

import { formatCurrency } from '@/shared/utils/currency'

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

export const GHS = (n: number) => formatCurrency(n)

export const formatPct = (n: number) => `${Number(n).toFixed(1)}%`
