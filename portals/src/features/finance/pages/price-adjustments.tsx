import { TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { getPriceAdjustmentsReport, type PriceAdjustmentRow } from '@/lib/actions/reports'
import { useApiQuery } from '@/lib/query'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { formatCurrency } from '@/shared/utils/currency'

function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function typeLabel(type: string, value: number): string {
  if (type === 'percent') return `${value}%`
  if (type === 'amount') return formatCurrency(value)
  return '—'
}

/**
 * Admin-only monitoring view of surcharges and discounts applied at estimate
 * time (0215). Neither lever requires a reason to enter — this report is the
 * detection mechanism instead: an admin can review who adjusted what, on
 * which patient/service, and by how much, and follow up directly if a row
 * looks off.
 */
function AdjustmentsTable({
  rows,
  emptyLabel,
}: {
  rows: PriceAdjustmentRow[]
  emptyLabel: string
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    )
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Invoice</TableHead>
            <TableHead>Patient</TableHead>
            <TableHead>Service</TableHead>
            <TableHead className="text-right">Standard</TableHead>
            <TableHead>Adjustment</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Δ%</TableHead>
            <TableHead>By</TableHead>
            <TableHead>Provider</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.lineId}>
              <TableCell className="whitespace-nowrap">{fmtDate(r.issueDate)}</TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs">
                {r.invoiceNumber}
              </TableCell>
              <TableCell>{r.patientName ?? '—'}</TableCell>
              <TableCell className="max-w-[220px] truncate">{r.description}</TableCell>
              <TableCell className="text-right">{formatCurrency(r.lineSubtotal)}</TableCell>
              <TableCell>{typeLabel(r.type, r.value)}</TableCell>
              <TableCell className="text-right font-medium">{formatCurrency(r.amount)}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                {r.deltaPct != null ? `${r.deltaPct.toFixed(1)}%` : '—'}
              </TableCell>
              <TableCell>{r.byName ?? '—'}</TableCell>
              <TableCell>{r.providerName ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export default function PriceAdjustmentsPage() {
  const [from, setFrom] = useState(() => isoDaysAgo(30))
  const [to, setTo] = useState(() => isoDaysAgo(0))

  const query = useApiQuery(
    ['finance', 'price-adjustments', from, to] as const,
    () => getPriceAdjustmentsReport(from, to),
    { enabled: !!from && !!to }
  )

  const data = query.data
  const surcharges = useMemo(() => data?.surcharges ?? [], [data])
  const discounts = useMemo(() => data?.discounts ?? [], [data])

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold">Price Adjustments</h1>
        <p className="text-sm text-muted-foreground">
          Every surcharge and discount applied at estimate time, admin-only. Neither requires a
          reason at entry — review here instead.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pa-from">From</Label>
          <Input
            id="pa-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pa-to">To</Label>
          <Input
            id="pa-to"
            type="date"
            value={to}
            min={from}
            max={isoDaysAgo(0)}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-lg border p-4">
          <TrendingUp className="h-5 w-5 text-orange-600" />
          <div>
            <p className="text-xs text-muted-foreground">Total surcharged</p>
            <p className="text-lg font-semibold">{formatCurrency(data?.totals.surcharges ?? 0)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border p-4">
          <TrendingDown className="h-5 w-5 text-emerald-600" />
          <div>
            <p className="text-xs text-muted-foreground">Total discounted</p>
            <p className="text-lg font-semibold">{formatCurrency(data?.totals.discounts ?? 0)}</p>
          </div>
        </div>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Tabs defaultValue="surcharges">
          <TabsList>
            <TabsTrigger value="surcharges">Surcharges ({surcharges.length})</TabsTrigger>
            <TabsTrigger value="discounts">Discounts ({discounts.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="surcharges" className="mt-3">
            <AdjustmentsTable rows={surcharges} emptyLabel="No surcharges in this date range." />
          </TabsContent>
          <TabsContent value="discounts" className="mt-3">
            <AdjustmentsTable rows={discounts} emptyLabel="No discounts in this date range." />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
