import { cn } from '@denel/utils'
import type { ReactNode } from 'react'

export type StatCardVariant = 'blue' | 'green' | 'amber' | 'purple' | 'rose' | 'slate'

const VARIANT_STYLES: Record<
  StatCardVariant,
  { card: string; label: string; value: string; hint: string; icon: string }
> = {
  blue: {
    card: 'from-blue-100/70 to-blue-50/40 border-blue-200/60 dark:from-blue-900/30 dark:to-blue-800/10 dark:border-blue-800/40',
    label: 'text-blue-700 dark:text-blue-400',
    value: 'text-blue-900 dark:text-blue-100',
    hint: 'text-blue-800/80 dark:text-blue-300/80',
    icon: 'bg-blue-600 text-white',
  },
  green: {
    card: 'from-emerald-100/70 to-emerald-50/40 border-emerald-200/60 dark:from-emerald-900/30 dark:to-emerald-800/10 dark:border-emerald-800/40',
    label: 'text-emerald-700 dark:text-emerald-400',
    value: 'text-emerald-900 dark:text-emerald-100',
    hint: 'text-emerald-800/80 dark:text-emerald-300/80',
    icon: 'bg-emerald-600 text-white',
  },
  amber: {
    card: 'from-amber-100/70 to-amber-50/40 border-amber-200/60 dark:from-amber-900/30 dark:to-amber-800/10 dark:border-amber-800/40',
    label: 'text-amber-700 dark:text-amber-400',
    value: 'text-amber-900 dark:text-amber-100',
    hint: 'text-amber-800/80 dark:text-amber-300/80',
    icon: 'bg-amber-600 text-white',
  },
  purple: {
    card: 'from-purple-100/70 to-purple-50/40 border-purple-200/60 dark:from-purple-900/30 dark:to-purple-800/10 dark:border-purple-800/40',
    label: 'text-purple-700 dark:text-purple-400',
    value: 'text-purple-900 dark:text-purple-100',
    hint: 'text-purple-800/80 dark:text-purple-300/80',
    icon: 'bg-purple-600 text-white',
  },
  rose: {
    card: 'from-rose-100/70 to-rose-50/40 border-rose-200/60 dark:from-rose-900/30 dark:to-rose-800/10 dark:border-rose-800/40',
    label: 'text-rose-700 dark:text-rose-400',
    value: 'text-rose-900 dark:text-rose-100',
    hint: 'text-rose-800/80 dark:text-rose-300/80',
    icon: 'bg-rose-600 text-white',
  },
  slate: {
    card: 'from-slate-100/70 to-slate-50/40 border-slate-200/60 dark:from-slate-800/40 dark:to-slate-800/10 dark:border-slate-700/40',
    label: 'text-slate-700 dark:text-slate-400',
    value: 'text-slate-900 dark:text-slate-100',
    hint: 'text-slate-700/80 dark:text-slate-300/80',
    icon: 'bg-slate-600 text-white',
  },
}

export interface StatCardProps {
  title: string
  value: ReactNode
  /** A lucide-react icon element (e.g. `<Users />`); colored by the variant. */
  icon?: ReactNode
  hint?: ReactNode
  variant?: StatCardVariant
  className?: string
}

/**
 * Colorful KPI card — gradient background, color-matched text, and a solid
 * icon chip. Presentational only (no router): wrap in a `<Link>` to make it
 * clickable. Mirrors the portal admin dashboard's stat cards.
 */
export function StatCard({ title, value, icon, hint, variant = 'blue', className }: StatCardProps) {
  const s = VARIANT_STYLES[variant]
  return (
    <div
      className={cn(
        'flex items-start justify-between rounded-xl border bg-gradient-to-br p-5 transition-shadow hover:shadow-sm',
        s.card,
        className
      )}
    >
      <div className="min-w-0 space-y-2">
        <p className={cn('text-sm font-medium', s.label)}>{title}</p>
        <p className={cn('text-3xl font-bold tabular-nums', s.value)}>{value}</p>
        {hint != null && <p className={cn('text-xs font-medium', s.hint)}>{hint}</p>}
      </div>
      {icon && (
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg shadow-sm [&>svg]:h-5 [&>svg]:w-5',
            s.icon
          )}
        >
          {icon}
        </div>
      )}
    </div>
  )
}
