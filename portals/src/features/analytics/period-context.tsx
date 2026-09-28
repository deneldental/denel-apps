import { createContext, type ReactNode, useCallback, useContext, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export type Granularity = 'monthly' | 'quarterly' | 'yearly'

export interface AnalyticsPeriod {
  granularity: Granularity
  /** Inclusive start of window. */
  from: Date
  /** Exclusive end of window (start of next interval). */
  to: Date
  /** Human-readable label, e.g. "May 2026" / "Q2 2026" / "2026". */
  label: string
  /** Year used as the anchor — needed by the financial page's year picker. */
  anchorYear: number
  /** Month index 0–11 for monthly; -1 otherwise. */
  anchorMonth: number
  /** Quarter 1–4 for quarterly; -1 otherwise. */
  anchorQuarter: number
}

interface AnalyticsPeriodContextValue {
  period: AnalyticsPeriod
  setGranularity: (g: Granularity) => void
  setAnchorYear: (y: number) => void
  setAnchorMonth: (m: number) => void
  setAnchorQuarter: (q: number) => void
  /** Returns the period as URL query params (granularity/from/to/label). */
  toQueryString: () => string
}

const Ctx = createContext<AnalyticsPeriodContextValue | null>(null)

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1, 0, 0, 0, 0)
}

function startOfNextMonth(year: number, month: number): Date {
  return new Date(year, month + 1, 1, 0, 0, 0, 0)
}

function startOfQuarter(year: number, q: number): Date {
  return new Date(year, (q - 1) * 3, 1, 0, 0, 0, 0)
}

function startOfNextQuarter(year: number, q: number): Date {
  return new Date(year, q * 3, 1, 0, 0, 0, 0)
}

function startOfYear(year: number): Date {
  return new Date(year, 0, 1, 0, 0, 0, 0)
}

function startOfNextYear(year: number): Date {
  return new Date(year + 1, 0, 1, 0, 0, 0, 0)
}

function quarterOfMonth(month: number): number {
  return Math.floor(month / 3) + 1
}

function buildPeriod(
  granularity: Granularity,
  anchorYear: number,
  anchorMonth: number,
  anchorQuarter: number
): AnalyticsPeriod {
  if (granularity === 'monthly') {
    const from = startOfMonth(anchorYear, anchorMonth)
    const to = startOfNextMonth(anchorYear, anchorMonth)
    return {
      granularity,
      from,
      to,
      label: from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      anchorYear,
      anchorMonth,
      anchorQuarter: -1,
    }
  }
  if (granularity === 'quarterly') {
    const from = startOfQuarter(anchorYear, anchorQuarter)
    const to = startOfNextQuarter(anchorYear, anchorQuarter)
    return {
      granularity,
      from,
      to,
      label: `Q${anchorQuarter} ${anchorYear}`,
      anchorYear,
      anchorMonth: -1,
      anchorQuarter,
    }
  }
  const from = startOfYear(anchorYear)
  const to = startOfNextYear(anchorYear)
  return {
    granularity,
    from,
    to,
    label: String(anchorYear),
    anchorYear,
    anchorMonth: -1,
    anchorQuarter: -1,
  }
}

function readFromUrl(params: URLSearchParams): {
  granularity: Granularity
  anchorYear: number
  anchorMonth: number
  anchorQuarter: number
} {
  const now = new Date()
  const defaultYear = now.getFullYear()
  const defaultMonth = now.getMonth()
  const defaultQuarter = quarterOfMonth(defaultMonth)

  const g = params.get('granularity')
  const granularity: Granularity =
    g === 'monthly' || g === 'quarterly' || g === 'yearly' ? g : 'monthly'

  const year = Number(params.get('year') ?? defaultYear)
  const month = Number(params.get('month') ?? defaultMonth)
  const quarter = Number(params.get('quarter') ?? defaultQuarter)

  return {
    granularity,
    anchorYear: Number.isFinite(year) ? year : defaultYear,
    anchorMonth: Number.isFinite(month) && month >= 0 && month <= 11 ? month : defaultMonth,
    anchorQuarter:
      Number.isFinite(quarter) && quarter >= 1 && quarter <= 4 ? quarter : defaultQuarter,
  }
}

export function AnalyticsPeriodProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams()

  const { granularity, anchorYear, anchorMonth, anchorQuarter } = useMemo(
    () => readFromUrl(searchParams),
    [searchParams]
  )

  const period = useMemo(
    () => buildPeriod(granularity, anchorYear, anchorMonth, anchorQuarter),
    [granularity, anchorYear, anchorMonth, anchorQuarter]
  )

  const writeUrl = useCallback(
    (next: Partial<{ granularity: Granularity; year: number; month: number; quarter: number }>) => {
      const params = new URLSearchParams(searchParams)
      const g = next.granularity ?? granularity
      params.set('granularity', g)
      params.set('year', String(next.year ?? anchorYear))
      if (g === 'monthly') {
        params.set('month', String(next.month ?? anchorMonth))
        params.delete('quarter')
      } else if (g === 'quarterly') {
        params.set('quarter', String(next.quarter ?? anchorQuarter))
        params.delete('month')
      } else {
        params.delete('month')
        params.delete('quarter')
      }
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams, granularity, anchorYear, anchorMonth, anchorQuarter]
  )

  const setGranularity = useCallback((g: Granularity) => writeUrl({ granularity: g }), [writeUrl])
  const setAnchorYear = useCallback((y: number) => writeUrl({ year: y }), [writeUrl])
  const setAnchorMonth = useCallback((m: number) => writeUrl({ month: m }), [writeUrl])
  const setAnchorQuarter = useCallback((q: number) => writeUrl({ quarter: q }), [writeUrl])

  const toQueryString = useCallback(() => {
    const params = new URLSearchParams()
    params.set('granularity', period.granularity)
    params.set('from', period.from.toISOString())
    params.set('to', period.to.toISOString())
    params.set('label', period.label)
    return params.toString()
  }, [period])

  const value = useMemo(
    () => ({
      period,
      setGranularity,
      setAnchorYear,
      setAnchorMonth,
      setAnchorQuarter,
      toQueryString,
    }),
    [period, setGranularity, setAnchorYear, setAnchorMonth, setAnchorQuarter, toQueryString]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAnalyticsPeriod(): AnalyticsPeriodContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAnalyticsPeriod must be used inside <AnalyticsPeriodProvider>')
  return v
}
