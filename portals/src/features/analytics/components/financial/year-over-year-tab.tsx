import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getMultiYearComparison, type MultiYearData } from '@/lib/actions/financial-analytics'
import { Button } from '@/shared/components/ui/button'
import { downloadCsv, todayStamp } from '@/shared/utils/csv'
import { CUSTOM_TOOLTIP_STYLE, GHS, GrowthBadge, SectionCard } from './shared'

interface Props {
  multiYear: MultiYearData
  currentYear: number
}

export function FinancialYearOverYearTab({ multiYear, currentYear }: Props) {
  const [rangeFrom, setRangeFrom] = useState(multiYear.from)
  const [rangeTo, setRangeTo] = useState(multiYear.to)
  const [localData, setLocalData] = useState<MultiYearData>(multiYear)
  const [loading, setLoading] = useState(false)

  async function refetch(from: number, to: number) {
    if (from > to || to - from > 10) return
    setLoading(true)
    const res = await getMultiYearComparison(from, to)
    if (res.success && res.data) setLocalData(res.data)
    setLoading(false)
  }

  function handleFrom(delta: number) {
    const next = rangeFrom + delta
    if (next >= 2000 && next <= rangeTo) {
      setRangeFrom(next)
      refetch(next, rangeTo)
    }
  }

  function handleTo(delta: number) {
    const next = rangeTo + delta
    if (next >= rangeFrom && next <= currentYear) {
      setRangeTo(next)
      refetch(rangeFrom, next)
    }
  }

  function exportCsv() {
    downloadCsv(
      `year-over-year-${rangeFrom}-${rangeTo}-${todayStamp()}.csv`,
      ['Year', 'Revenue', 'Expenses', 'Net Profit', 'Margin %'],
      localData.years.map((y) => [
        y.year,
        y.revenue,
        y.expenses,
        y.net_profit,
        y.revenue > 0 ? Math.round((y.net_profit / y.revenue) * 1000) / 10 : 0,
      ])
    )
  }

  return (
    <div className="space-y-4">
      {/* Range controls */}
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Range:</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => handleFrom(-1)}
            aria-label="Decrease from year"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center font-medium tabular-nums">{rangeFrom}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => handleFrom(1)}
            aria-label="Increase from year"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <span className="text-muted-foreground">–</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => handleTo(-1)}
            aria-label="Decrease to year"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center font-medium tabular-nums">{rangeTo}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => handleTo(1)}
            disabled={rangeTo >= currentYear}
            aria-label="Increase to year"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {loading && <span className="text-xs text-muted-foreground animate-pulse">Loading…</span>}
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={exportCsv} className="print:hidden">
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Grouped bar chart */}
      <SectionCard title="Revenue vs Expenses vs Net Profit by Year">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={localData.years} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 10 }}
              width={52}
            />
            <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v) => GHS(v as number)} />
            <Legend />
            <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} name="Revenue" />
            <Bar dataKey="expenses" fill="#ef4444" radius={[4, 4, 0, 0]} name="Expenses" />
            <Bar dataKey="net_profit" fill="#16a34a" radius={[4, 4, 0, 0]} name="Net Profit" />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* Annual summary table */}
      <SectionCard title="Annual Summary">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Year</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Expenses</th>
                <th className="text-right">Net Profit</th>
                <th className="text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {localData.years.map((row) => {
                const margin =
                  row.revenue > 0 ? Math.round((row.net_profit / row.revenue) * 1000) / 10 : 0
                return (
                  <tr key={row.year} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-1.5 font-medium">{row.year}</td>
                    <td className="text-right text-blue-700">{GHS(row.revenue)}</td>
                    <td className="text-right text-red-700">{GHS(row.expenses)}</td>
                    <td
                      className={`text-right font-medium ${row.net_profit >= 0 ? 'text-green-700' : 'text-red-700'}`}
                    >
                      {GHS(row.net_profit)}
                    </td>
                    <td className="text-right">
                      <GrowthBadge value={margin} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}
