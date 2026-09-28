import { cn, formatAmount, formatCurrency } from '@denel/utils'
import type * as React from 'react'

/**
 * Renders a money value.
 *
 * `value` is an integer count of MINOR UNITS — pesewas, which the codebase calls
 * cents — exactly as it comes off the API and out of the database (migration
 * 0209). The conversion to cedis happens here, once, and nowhere else.
 *
 *   <Amount value={1800000} />              GH₵18,000.00
 *   <Amount value={1800000} format="plain" />   18,000.00
 *
 * WHY A COMPONENT
 * ---------------
 * Because `GHS ${Number(x).toFixed(2)}` typechecks, lints, and ships a number
 * 100x too large — which is how a GHS 18,000.00 invoice reached a patient as
 * "GHS 1800000.00". A component is greppable, reviewable in a diff, and cannot
 * silently take a cedis value and a cents value as the same thing. Prefer it to
 * calling `formatCurrency` inline in JSX.
 *
 * Named `Amount`, not `Money`, to avoid colliding with the `Money` arithmetic
 * class in `@denel/utils` — one import list should never contain two different
 * things called Money.
 *
 * See project-docs/money-unit-audit-and-remediation.md.
 */
export interface AmountProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Integer minor units (pesewas). Nullish renders as zero. */
  value: number | string | null | undefined
  /**
   * `symbol` (default) renders `GH₵18,000.00`.
   * `plain` renders `18,000.00`, for tables and slips that print their own label.
   */
  format?: 'symbol' | 'plain'
}

export function Amount({ value, format = 'symbol', className, ...props }: AmountProps) {
  const text = format === 'plain' ? formatAmount(value) : formatCurrency(value)
  return (
    <span className={cn('tabular-nums', className)} {...props}>
      {text}
    </span>
  )
}
