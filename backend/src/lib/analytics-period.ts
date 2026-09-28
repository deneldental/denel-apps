import type { Context } from 'hono'

export type Granularity = 'monthly' | 'quarterly' | 'yearly'

export interface AnalyticsPeriod {
  granularity: Granularity
  from: Date
  to: Date
  label: string
}

const VALID_GRANULARITY: Granularity[] = ['monthly', 'quarterly', 'yearly']

/**
 * Read a period filter off the request:
 *   ?granularity=monthly|quarterly|yearly&from=ISO&to=ISO[&label=…]
 *
 * Returns the parsed window or `null` if no period was supplied, letting each
 * endpoint keep its existing rolling-window default for backward compatibility.
 * `to` is treated as exclusive (frontend supplies start of next interval).
 */
export function parsePeriod(c: Context): AnalyticsPeriod | null {
  const granularity = c.req.query('granularity') as Granularity | undefined
  const fromStr = c.req.query('from')
  const toStr = c.req.query('to')

  if (!granularity || !fromStr || !toStr) return null
  if (!VALID_GRANULARITY.includes(granularity)) return null

  const from = new Date(fromStr)
  const to = new Date(toStr)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  if (to <= from) return null

  return {
    granularity,
    from,
    to,
    label: c.req.query('label') ?? defaultLabel(granularity, from),
  }
}

function defaultLabel(granularity: Granularity, from: Date): string {
  const y = from.getFullYear()
  if (granularity === 'yearly') return String(y)
  if (granularity === 'quarterly') {
    const q = Math.floor(from.getMonth() / 3) + 1
    return `Q${q} ${y}`
  }
  return from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

/**
 * Choose a sensible trend bucket size for the active period.
 * - monthly  → day buckets (≤31 points)
 * - quarterly → week buckets (~13 points)
 * - yearly  → month buckets (12 points)
 */
export function trendBucket(period: AnalyticsPeriod): 'day' | 'week' | 'month' {
  if (period.granularity === 'monthly') return 'day'
  if (period.granularity === 'quarterly') return 'week'
  return 'month'
}
