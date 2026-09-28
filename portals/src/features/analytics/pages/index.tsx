import { ChevronLeft, ChevronRight, Minus, Printer, TrendingDown, TrendingUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  type PieLabelRenderProps,
  ResponsiveContainer,
  Tooltip,
  type TooltipPayloadEntry,
  XAxis,
  YAxis,
} from 'recharts'
import {
  type ExpenseCategory,
  getAnalytics,
  type PaymentMethod,
  type QuarterData,
  type TreatmentRevenue,
} from '@/lib/actions/analytics'
import { useBranding } from '@/lib/branding-context'
import { useLoading } from '@/lib/loading-context'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { formatAmount } from '@/shared/utils/currency'

// ── Colour palettes ───────────────────────────────────────────────────────────
const TREATMENT_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#16a34a',
  '#0891b2',
  '#9333ea',
  '#dc2626',
]
const EXPENSE_COLORS = [
  '#f97316',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]
const METHOD_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

const GHS = (n: number) => `GHS ${formatAmount(n)}`

// ── Quarter names / ranges ────────────────────────────────────────────────────
const QUARTER_META = {
  Q1: { label: 'Q1', range: 'January – March' },
  Q2: { label: 'Q2', range: 'April – June' },
  Q3: { label: 'Q3', range: 'July – September' },
  Q4: { label: 'Q4', range: 'October – December' },
} as const

type QKey = keyof typeof QUARTER_META

// ── Small helpers ─────────────────────────────────────────────────────────────
function GrowthBadge({ value }: { value: number | null }) {
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

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4 print:border-gray-300 print:shadow-none">
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </div>
  )
}

const CUSTOM_TOOLTIP_STYLE = { fontSize: 12, borderRadius: 6 }

// ── Per-quarter block ─────────────────────────────────────────────────────────
function QuarterSection({ qKey, data, year }: { qKey: QKey; data: QuarterData; year: number }) {
  const meta = QUARTER_META[qKey]
  const isEmpty = data.patients.total === 0 && data.revenue.total === 0 && data.expenses.total === 0

  return (
    <section className="mb-8 print:mb-6 print:break-inside-avoid">
      {/* Quarter header */}
      <div className="mb-4 flex items-center justify-between border-b pb-2">
        <div>
          <h2 className="text-xl font-bold">
            {meta.label} — {year}
          </h2>
          <p className="text-sm text-muted-foreground">{meta.range}</p>
        </div>
        <div className="flex gap-6 text-right text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Patients</div>
            <div className="font-semibold">{data.patients.total}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Revenue</div>
            <div className="font-semibold">{GHS(data.revenue.total)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Expenses</div>
            <div className="font-semibold">{GHS(data.expenses.total)}</div>
          </div>
        </div>
      </div>

      {isEmpty ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No data recorded for this quarter.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* 1 – Patients per month */}
          <SectionCard title="Patients per Month">
            <div className="mb-3 flex gap-6">
              {data.patients.monthly.map((m) => (
                <div key={m.month} className="text-center">
                  <div className="text-lg font-bold">{m.count}</div>
                  <div className="text-xs text-muted-foreground">{m.month}</div>
                  <GrowthBadge value={m.growth} />
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={data.patients.monthly}
                margin={{ top: 24, right: 16, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} />
                <Bar dataKey="count" name="Patients" fill="#2563eb" radius={[4, 4, 0, 0]}>
                  <LabelList
                    dataKey="count"
                    position="top"
                    style={{ fontSize: 12, fontWeight: 600, fill: '#374151' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>

          {/* 2 – Revenue by treatment */}
          <SectionCard title="Revenue by Treatment">
            {data.revenue.byTreatment.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No treatment revenue data.
              </p>
            ) : (
              <ResponsiveContainer
                width="100%"
                height={Math.max(200, data.revenue.byTreatment.slice(0, 10).length * 36)}
              >
                <BarChart
                  layout="vertical"
                  data={data.revenue.byTreatment.slice(0, 10)}
                  margin={{ top: 0, right: 120, left: 16, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `GHS ${v.toLocaleString()}`}
                  />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip
                    contentStyle={CUSTOM_TOOLTIP_STYLE}
                    formatter={(v, _unused, entry: TooltipPayloadEntry) => [
                      `${GHS(v as number)} (${(entry.payload as TreatmentRevenue).percentage}%)`,
                      'Revenue',
                    ]}
                  />
                  <Bar dataKey="amount" name="Revenue" radius={[0, 4, 4, 0]}>
                    {data.revenue.byTreatment.slice(0, 10).map((_, i) => (
                      <Cell key={i} fill={TREATMENT_COLORS[i % TREATMENT_COLORS.length]} />
                    ))}
                    <LabelList
                      dataKey="amount"
                      position="right"
                      formatter={(v) => GHS(v as number)}
                      style={{ fontSize: 11, fontWeight: 600, fill: '#374151' }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </SectionCard>

          {/* 3 – Expenses by category */}
          <SectionCard title="Expenses Breakdown">
            {data.expenses.byCategory.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No expense data.</p>
            ) : (
              <div className="flex items-center gap-6">
                <div className="w-64 flex-shrink-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={data.expenses.byCategory}
                        dataKey="amount"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={(props: PieLabelRenderProps & Partial<ExpenseCategory>) =>
                          `${props.percentage}%`
                        }
                        labelLine={false}
                      >
                        {data.expenses.byCategory.map((_, i) => (
                          <Cell key={i} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={CUSTOM_TOOLTIP_STYLE}
                        formatter={(v) => [GHS(v as number), 'Amount']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="pb-1 text-left font-medium">Category</th>
                        <th className="pb-1 text-right font-medium">Amount</th>
                        <th className="pb-1 text-right font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.expenses.byCategory.map((item, i) => (
                        <tr key={item.category} className="border-b last:border-0">
                          <td className="py-1.5">
                            <span className="flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                                style={{
                                  backgroundColor: EXPENSE_COLORS[i % EXPENSE_COLORS.length],
                                }}
                              />
                              <span className="capitalize">{item.category}</span>
                            </span>
                          </td>
                          <td className="py-1.5 text-right font-medium">{GHS(item.amount)}</td>
                          <td className="py-1.5 text-right text-muted-foreground">
                            {item.percentage}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </SectionCard>

          {/* 4 – Payment methods */}
          <SectionCard title="Payment Methods">
            {data.paymentMethods.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No payment data.</p>
            ) : (
              <div className="flex items-center gap-6">
                <div className="w-64 flex-shrink-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={data.paymentMethods}
                        dataKey="count"
                        nameKey="method"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={(props: PieLabelRenderProps & Partial<PaymentMethod>) =>
                          `${props.percentage}%`
                        }
                        labelLine={false}
                      >
                        {data.paymentMethods.map((_, i) => (
                          <Cell key={i} fill={METHOD_COLORS[i % METHOD_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={CUSTOM_TOOLTIP_STYLE}
                        formatter={(v, _unused, entry: TooltipPayloadEntry) => [
                          `${v as number} transactions (${GHS((entry.payload as PaymentMethod).amount)})`,
                          'Method',
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="pb-1 text-left font-medium">Method</th>
                        <th className="pb-1 text-right font-medium">Transactions</th>
                        <th className="pb-1 text-right font-medium">Amount</th>
                        <th className="pb-1 text-right font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.paymentMethods.map((item, i) => (
                        <tr key={item.method} className="border-b last:border-0">
                          <td className="py-1.5">
                            <span className="flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: METHOD_COLORS[i % METHOD_COLORS.length] }}
                              />
                              <span className="capitalize">{item.method}</span>
                            </span>
                          </td>
                          <td className="py-1.5 text-right">{item.count}</td>
                          <td className="py-1.5 text-right font-medium">{GHS(item.amount)}</td>
                          <td className="py-1.5 text-right text-muted-foreground">
                            {item.percentage}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </SectionCard>

          {/* 5 – Treatment frequency */}
          <SectionCard title="Treatment Frequency">
            {data.treatments.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No treatment data.</p>
            ) : (
              <div className="space-y-2.5">
                {data.treatments.slice(0, 10).map((t, i) => (
                  <div key={t.name} className="flex items-center gap-3">
                    <div className="w-36 truncate text-right text-sm text-muted-foreground">
                      {t.name}
                    </div>
                    <div className="flex flex-1 items-center gap-3">
                      <div
                        className="h-6 rounded flex-shrink-0"
                        style={{
                          width: `${t.percentage}%`,
                          backgroundColor: TREATMENT_COLORS[i % TREATMENT_COLORS.length],
                          minWidth: 4,
                        }}
                      />
                      <span className="text-sm font-medium whitespace-nowrap">
                        {t.count} ({t.percentage}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </section>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
// Computed once at module load — stable for the session.
const CURRENT_YEAR = new Date().getFullYear()

export default function AnalyticsPage() {
  const branding = useBranding()
  const [year, setYear] = useState(CURRENT_YEAR)
  const query = useApiQuery(queryKeys.analytics.financial({ year }), () => getAnalytics(year))
  const data = query.data ?? null
  const error = query.error ? query.error.message : null
  const { setIsLoading } = useLoading()
  const printRef = useRef<HTMLDivElement>(null)

  // The global loading indicator is wired to this page's fetch lifecycle, same
  // as before the TanStack Query migration — mirror the query's isLoading.
  useEffect(() => {
    setIsLoading(query.isLoading)
  }, [query.isLoading, setIsLoading])

  const handlePrint = () => window.print()

  return (
    <div className="flex flex-col gap-6 p-6 print:p-4">
      {/* Header */}
      <div className="flex items-start justify-between print:hidden">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">
            Quarterly KPI breakdown — patients, revenue, expenses, payment methods & treatments.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Year selector */}
          <div className="flex items-center gap-1 rounded-lg border bg-background px-2 py-1">
            <button
              onClick={() => setYear((y) => y - 1)}
              disabled={year <= 2020}
              className="p-1 rounded hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[3.5rem] text-center text-sm font-semibold">{year}</span>
            <button
              onClick={() => setYear((y) => y + 1)}
              disabled={year >= CURRENT_YEAR}
              className="p-1 rounded hover:bg-muted disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            <Printer className="h-4 w-4" />
            Print Report
          </button>
        </div>
      </div>

      {/* Print header (only visible when printing) */}
      <div className="hidden print:block mb-4">
        <h1 className="text-2xl font-bold">{branding.name} — Analytics Report</h1>
        <p className="text-sm text-gray-500">
          Year: {year} · Generated: {new Date().toLocaleDateString('en-GH', { dateStyle: 'long' })}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {data && (
        <div ref={printRef}>
          {(['Q1', 'Q2', 'Q3', 'Q4'] as QKey[])
            .filter((qKey) => {
              const q = data[qKey]
              return q.patients.total > 0 || q.revenue.total > 0 || q.expenses.total > 0
            })
            .map((qKey) => (
              <QuarterSection key={qKey} qKey={qKey} data={data[qKey]} year={year} />
            ))}
        </div>
      )}

      <style>{`
        @media print {
          body * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          .print\\:break-inside-avoid { break-inside: avoid; }
          .print\\:p-4 { padding: 1rem; }
          .print\\:mb-6 { margin-bottom: 1.5rem; }
          .print\\:border-gray-300 { border-color: #d1d5db; }
          .print\\:shadow-none { box-shadow: none; }
        }
      `}</style>
    </div>
  )
}
