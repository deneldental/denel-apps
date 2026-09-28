import { cn } from '@denel/utils'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Colored home-screen cards — a soft tinted surface + icon chip in a fixed tone.
 * `StatCard` = icon + big value + label; `NavCard` = icon + title + subtitle +
 * chevron. Both link (via `to`) or fire `onClick`. Tone class strings are spelled
 * out statically below so Tailwind's scanner emits them.
 */

export type CardTone = 'sky' | 'rose' | 'emerald' | 'teal' | 'violet' | 'indigo' | 'amber' | 'brand'

interface ToneClasses {
  card: string
  chip: string
  value: string
  label: string
  chevron: string
}

const TONES: Record<CardTone, ToneClasses> = {
  sky: {
    card: 'border-sky-100 bg-sky-50 hover:border-sky-300',
    chip: 'bg-sky-100 text-sky-700',
    value: 'text-sky-900',
    label: 'text-sky-700/80',
    chevron: 'text-sky-400',
  },
  rose: {
    card: 'border-rose-100 bg-rose-50 hover:border-rose-300',
    chip: 'bg-rose-100 text-rose-700',
    value: 'text-rose-900',
    label: 'text-rose-700/80',
    chevron: 'text-rose-400',
  },
  emerald: {
    card: 'border-emerald-100 bg-emerald-50 hover:border-emerald-300',
    chip: 'bg-emerald-100 text-emerald-700',
    value: 'text-emerald-900',
    label: 'text-emerald-700/80',
    chevron: 'text-emerald-400',
  },
  teal: {
    card: 'border-teal-100 bg-teal-50 hover:border-teal-300',
    chip: 'bg-teal-100 text-teal-700',
    value: 'text-teal-900',
    label: 'text-teal-700/80',
    chevron: 'text-teal-400',
  },
  violet: {
    card: 'border-violet-100 bg-violet-50 hover:border-violet-300',
    chip: 'bg-violet-100 text-violet-700',
    value: 'text-violet-900',
    label: 'text-violet-700/80',
    chevron: 'text-violet-400',
  },
  indigo: {
    card: 'border-indigo-100 bg-indigo-50 hover:border-indigo-300',
    chip: 'bg-indigo-100 text-indigo-700',
    value: 'text-indigo-900',
    label: 'text-indigo-700/80',
    chevron: 'text-indigo-400',
  },
  amber: {
    card: 'border-amber-100 bg-amber-50 hover:border-amber-300',
    chip: 'bg-amber-100 text-amber-700',
    value: 'text-amber-900',
    label: 'text-amber-700/80',
    chevron: 'text-amber-400',
  },
  brand: {
    card: 'border-brand/20 bg-brand/5 hover:border-brand/40',
    chip: 'bg-brand/15 text-brand',
    value: 'text-foreground',
    label: 'text-muted-foreground',
    chevron: 'text-brand/60',
  },
}

/**
 * Notification count bubble pinned to a card's top-right corner. Renders nothing
 * for a zero/absent count so cards stay clean until there's something new.
 */
function CardBadge({ count }: { count?: number }) {
  if (!count || count < 1) return null
  return (
    <span
      role="status"
      aria-label={`${count} new`}
      className="absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold leading-none text-white shadow-sm ring-2 ring-white"
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}

function CardShell({
  to,
  onClick,
  className,
  children,
}: {
  to?: string
  onClick?: () => void
  className: string
  children: ReactNode
}) {
  if (to)
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cn(className, 'w-full text-left')}>
        {children}
      </button>
    )
  return <div className={className}>{children}</div>
}

export interface StatCardProps {
  tone: CardTone
  icon: LucideIcon
  value: ReactNode
  label: string
  to?: string
  onClick?: () => void
  /** Show a chevron in the top-right (indicates the card is tappable). */
  chevron?: boolean
  /** Notification count bubble in the top-right corner (hidden when 0/undefined). */
  badge?: number
}

export function StatCard({
  tone,
  icon: Icon,
  value,
  label,
  to,
  onClick,
  chevron = false,
  badge,
}: StatCardProps) {
  const t = TONES[tone]
  return (
    <CardShell
      to={to}
      onClick={onClick}
      className={cn('relative block rounded-2xl border p-4 transition-colors', t.card)}
    >
      <CardBadge count={badge} />
      <div className="mb-2 flex items-center justify-between">
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl', t.chip)}>
          <Icon className="h-4 w-4" />
        </div>
        {chevron && <ChevronRight className={cn('h-4 w-4', t.chevron)} />}
      </div>
      <p className={cn('text-sm font-bold leading-tight', t.value)}>{label}</p>
      <p className={cn('mt-1 text-xs font-semibold', t.label)}>{value}</p>
    </CardShell>
  )
}

export interface NavCardProps {
  tone: CardTone
  icon: LucideIcon
  title: string
  subtitle?: string
  to?: string
  onClick?: () => void
  chevron?: boolean
  /** Notification count bubble in the top-right corner (hidden when 0/undefined). */
  badge?: number
}

export function NavCard({
  tone,
  icon: Icon,
  title,
  subtitle,
  to,
  onClick,
  chevron = true,
  badge,
}: NavCardProps) {
  const t = TONES[tone]
  return (
    <CardShell
      to={to}
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-3 rounded-2xl border p-4 transition-colors',
        t.card
      )}
    >
      <CardBadge count={badge} />
      <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', t.chip)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-semibold', t.value)}>{title}</p>
        {subtitle && <p className={cn('text-xs', t.label)}>{subtitle}</p>}
      </div>
      {chevron && <ChevronRight className={cn('h-5 w-5 shrink-0', t.chevron)} />}
    </CardShell>
  )
}
