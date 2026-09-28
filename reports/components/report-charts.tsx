import { formatCurrency } from '@denel/utils'
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// Shared categorical palette for the finance charts. Kept small and stable so
// a category keeps its colour between renders.
const PALETTE = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#ec4899', // pink
  '#6366f1', // indigo
]

// recharts passes tooltip/label values as `unknown`-ish; coerce defensively so
// a missing/NaN value renders as a clean GHS string, never `GHS NaN`.
function asCurrency(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value)
  return formatCurrency(Number.isFinite(n) ? n : 0)
}

const COMPACT = new Intl.NumberFormat('en-GH', { notation: 'compact' })

export type ChartDatum = {
  /** X-axis / slice label. */
  label: string
  /** Numeric value. */
  value: number
}

/**
 * Horizontal-friendly vertical bar chart for category / provider / supplier
 * breakdowns. Values are GHS amounts.
 */
export function ReportBarChart({
  data,
  height = 280,
  color = PALETTE[1],
}: {
  data: ChartDatum[]
  height?: number
  color?: string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11 }}
          interval={0}
          angle={-15}
          textAnchor="end"
          height={56}
        />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => COMPACT.format(Number(v))} />
        <Tooltip formatter={(value) => asCurrency(value)} />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/**
 * Pie chart for share-of-total breakdowns (revenue by category / provider).
 */
export function ReportPieChart({ data, height = 280 }: { data: ChartDatum[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          outerRadius={90}
          // recharts spreads the datum into the label render props at runtime
          // but doesn't type the custom `label` field — cast to read it.
          label={(entry) => String((entry as { label?: unknown }).label ?? '')}
        >
          {data.map((entry, idx) => (
            <Cell key={`${entry.label}-${idx}`} fill={PALETTE[idx % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => asCurrency(value)} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}

export type WaterfallDatum = {
  label: string
  /** The signed delta this step contributes (e.g. +inflow, −outflow). */
  delta: number
}

/**
 * Waterfall chart for cash-flow style "opening → ±steps → closing" narratives.
 * Each bar is drawn as a floating segment from the running total before the
 * step to the running total after it; positive steps are green, negative red.
 */
export function ReportWaterfallChart({
  opening,
  steps,
  height = 300,
}: {
  opening: number
  steps: WaterfallDatum[]
  height?: number
}) {
  let running = opening
  const bars = [
    { label: 'Opening', base: 0, span: opening, delta: opening, kind: 'total' as const },
    ...steps.map((s) => {
      const start = running
      running += s.delta
      const base = Math.min(start, running)
      return {
        label: s.label,
        base,
        span: Math.abs(s.delta),
        delta: s.delta,
        kind: (s.delta >= 0 ? 'up' : 'down') as 'up' | 'down',
      }
    }),
    { label: 'Closing', base: 0, span: running, delta: running, kind: 'total' as const },
  ]

  const colorFor = (kind: 'total' | 'up' | 'down') =>
    kind === 'total' ? PALETTE[1] : kind === 'up' ? PALETTE[0] : PALETTE[3]

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={bars} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11 }}
          interval={0}
          angle={-15}
          textAnchor="end"
          height={56}
        />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => COMPACT.format(Number(v))} />
        <Tooltip
          formatter={(_value, _name, item) => {
            const payload = (item as { payload?: { delta?: number } } | undefined)?.payload
            return asCurrency(payload?.delta ?? 0)
          }}
        />
        <ReferenceLine y={0} stroke="#9ca3af" />
        {/* Invisible spacer raises the visible segment to its `base`. */}
        <Bar dataKey="base" stackId="wf" fill="transparent" />
        <Bar dataKey="span" stackId="wf" radius={[3, 3, 0, 0]}>
          {bars.map((b, idx) => (
            <Cell key={`${b.label}-${idx}`} fill={colorFor(b.kind)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
