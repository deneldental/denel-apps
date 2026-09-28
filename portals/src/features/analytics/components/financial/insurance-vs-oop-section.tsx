import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { getPaymentMethodSplit } from '@/lib/actions/financial-analytics'
import { useApiQuery } from '@/lib/query'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { CUSTOM_TOOLTIP_STYLE, GHS, METHOD_COLORS, SectionCard } from './shared'

const PAYMENT_METHOD_SPLIT_KEY = (year: number) =>
  ['analytics', 'financial', 'payment-method-split', year] as const

/**
 * Insurance vs Out-of-Pocket — donut chart of the two-way split (insurance =
 * method=insurance, OOP = everything else), plus a per-method breakdown table.
 *
 * Replaces the simple Payment Methods donut from the original orphan with a
 * richer view that also surfaces the insurance vs OOP rollup commonly asked
 * for in annual reports.
 */
export function InsuranceVsOopSection({ year }: { year: number }) {
  const query = useApiQuery(PAYMENT_METHOD_SPLIT_KEY(year), () => getPaymentMethodSplit(year))
  const data = query.data ?? null
  const loading = query.isLoading

  if (loading) {
    return (
      <SectionCard title="Payment Methods & Insurance Split">
        <Skeleton className="h-[200px] w-full" />
      </SectionCard>
    )
  }
  if (!data || data.totals.count === 0) {
    return (
      <SectionCard title="Payment Methods & Insurance Split">
        <p className="py-4 text-center text-xs text-muted-foreground">No payment data</p>
      </SectionCard>
    )
  }

  const insuranceVsOop = [
    {
      name: 'Insurance',
      value: data.insuranceVsOop.insurance.amount,
      count: data.insuranceVsOop.insurance.count,
    },
    {
      name: 'Out-of-Pocket',
      value: data.insuranceVsOop.out_of_pocket.amount,
      count: data.insuranceVsOop.out_of_pocket.count,
    },
  ]

  return (
    <SectionCard title="Payment Methods & Insurance Split">
      <div className="grid md:grid-cols-2 gap-4">
        {/* Insurance vs OOP donut */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">Insurance vs Out-of-Pocket</p>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={insuranceVsOop}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
              >
                <Cell fill="#0ea5e9" />
                <Cell fill="#f97316" />
              </Pie>
              <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v) => GHS(v as number)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
          <table className="w-full text-xs mt-1">
            <tbody>
              <tr className="border-b">
                <td className="py-1">Insurance</td>
                <td className="text-right">{data.insuranceVsOop.insurance.count} txns</td>
                <td className="text-right font-medium">
                  {GHS(data.insuranceVsOop.insurance.amount)}
                </td>
                <td className="text-right text-muted-foreground">
                  {data.insuranceVsOop.insurance.percentage}%
                </td>
              </tr>
              <tr>
                <td className="py-1">Out-of-Pocket</td>
                <td className="text-right">{data.insuranceVsOop.out_of_pocket.count} txns</td>
                <td className="text-right font-medium">
                  {GHS(data.insuranceVsOop.out_of_pocket.amount)}
                </td>
                <td className="text-right text-muted-foreground">
                  {data.insuranceVsOop.out_of_pocket.percentage}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Per-method breakdown */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">All methods</p>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={data.byMethod}
                dataKey="amount"
                nameKey="method"
                cx="50%"
                cy="50%"
                outerRadius={80}
              >
                {data.byMethod.map((_, i) => (
                  <Cell key={i} fill={METHOD_COLORS[i % METHOD_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v) => GHS(v as number)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
          <table className="w-full text-xs mt-1">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1">Method</th>
                <th className="text-right">Txns</th>
                <th className="text-right">Amount</th>
                <th className="text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {data.byMethod.map((m) => (
                <tr key={m.method} className="border-b last:border-0">
                  <td className="py-1 capitalize">{m.method}</td>
                  <td className="text-right">{m.count}</td>
                  <td className="text-right font-medium">{GHS(m.amount)}</td>
                  <td className="text-right text-muted-foreground">{m.percentage}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  )
}
