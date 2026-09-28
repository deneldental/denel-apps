import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ComparisonArrowProps {
  value: number
  /** When true, an increase is bad (e.g. expenses): green → red colour flip. */
  invertColor?: boolean
  className?: string
}

/**
 * Colour-coded arrow + percentage used in list rows and the detail ribbon.
 * Positive % → up arrow. Negative % → down arrow. Zero → horizontal dash.
 */
export function ComparisonArrow({ value, invertColor = false, className }: ComparisonArrowProps) {
  const isZero = value === 0
  const isUp = value > 0
  const goodUp = !invertColor
  const positiveIsGood = (isUp && goodUp) || (!isUp && !goodUp && !isZero)
  const colorClass = isZero
    ? 'text-muted-foreground'
    : positiveIsGood
      ? 'text-emerald-600'
      : 'text-red-600'

  const Icon = isZero ? Minus : isUp ? ArrowUp : ArrowDown
  const sign = value > 0 ? '+' : ''

  return (
    <span
      className={cn('inline-flex items-center gap-1 text-sm font-medium', colorClass, className)}
    >
      <Icon className="h-3.5 w-3.5" />
      {sign}
      {value}%
    </span>
  )
}
