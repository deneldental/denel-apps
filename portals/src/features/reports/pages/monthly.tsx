import { format, parseISO } from 'date-fns'
import { ArrowDown, ArrowUp, Loader2, Printer } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PeriodReport } from '@/features/reports/components/period-report'
import { getPeriodList, type PeriodListEntry } from '@/lib/actions/period-report'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { formatCurrency, formatCurrencyCompact } from '@/shared/utils/currency'

type ThresholdItem = {
  id: string
  inventoryItemId: string
  inventoryItemName: string
  costPrice: number
  quantity: number
}

// Local query key — reports has no matching group in `query-keys.ts`.
const MONTHLY_PERIOD_LIST_KEY = ['reports', 'period-list', 'monthly', 6] as const

export default function MonthlySummariesPage() {
  const periodListQuery = useApiQuery<PeriodListEntry[]>(MONTHLY_PERIOD_LIST_KEY, () =>
    getPeriodList('monthly', 6)
  )
  const rows = periodListQuery.data ?? []
  const loading = periodListQuery.isLoading

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Monthly Summaries</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monthly rollups. Click a row for the full breakdown.
        </p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">vs prior</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Patients</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    No data available.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((m) => (
                  <TableRow key={m.key} className="cursor-pointer hover:bg-muted/40">
                    <TableCell>
                      <Link to={`/reports/monthly/${m.key}`} className="block">
                        <span className="font-medium">
                          {format(parseISO(m.start), 'MMMM yyyy')}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell
                      className="text-right font-semibold tabular-nums"
                      title={formatCurrency(m.revenue)}
                    >
                      {formatCurrencyCompact(m.revenue)}
                    </TableCell>
                    <TableCell className="text-right">
                      <VsPrior pct={m.vsPrior.revenuePct} />
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums text-muted-foreground"
                      title={formatCurrency(m.expenses)}
                    >
                      {formatCurrencyCompact(m.expenses)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.patientCount}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

export function MonthlyDetailPage() {
  const { monthStart = '' } = useParams<{ monthStart: string }>()
  const navigate = useNavigate()

  const start = parseISO(monthStart)
  if (!monthStart || Number.isNaN(start.getTime())) {
    return (
      <div className="p-6 space-y-3 text-center">
        <p className="text-lg font-medium">Invalid month</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/reports/monthly')}>
          Back to monthly summaries
        </Button>
      </div>
    )
  }
  // End of month = day 0 of next month
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
  const fromStr = format(start, 'yyyy-MM-dd')
  const toStr = format(end, 'yyyy-MM-dd')
  const monthLabel = format(start, 'MMMM yyyy')

  return (
    <div className="p-6 space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <button
          type="button"
          className="hover:text-foreground hover:underline"
          onClick={() => navigate('/reports/monthly')}
        >
          Monthly Summaries
        </button>
        <span className="mx-2">›</span>
        <span className="font-medium text-foreground">{monthLabel}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{monthLabel}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {format(start, 'MMM d')} – {format(end, 'MMM d, yyyy')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-3.5 w-3.5" />
          Print
        </Button>
      </div>

      <PeriodReport from={fromStr} to={toStr} />

      <InventoryReconciliation monthLabel={monthLabel} />
    </div>
  )
}

function VsPrior({ pct }: { pct: number }) {
  if (pct === 0) return <span className="text-xs text-muted-foreground">0%</span>
  const up = pct > 0
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${up ? 'text-emerald-600' : 'text-rose-600'}`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(pct).toFixed(0)}%
    </span>
  )
}

// ── Inventory Reconciliation ──────────────────────────────────────────────────

const SAMPLE_THRESHOLD_ITEMS: ThresholdItem[] = [
  {
    id: 'sample_1',
    inventoryItemId: 'sample_inv_1',
    inventoryItemName: 'Composite Resin A2',
    costPrice: 145,
    quantity: 20,
  },
  {
    id: 'sample_2',
    inventoryItemId: 'sample_inv_2',
    inventoryItemName: 'Latex Gloves',
    costPrice: 48,
    quantity: 30,
  },
  {
    id: 'sample_3',
    inventoryItemId: 'sample_inv_3',
    inventoryItemName: 'Sterilization Pouches',
    costPrice: 75,
    quantity: 15,
  },
  {
    id: 'sample_4',
    inventoryItemId: 'sample_inv_4',
    inventoryItemName: 'Bonding Agent',
    costPrice: 220,
    quantity: 10,
  },
  {
    id: 'sample_5',
    inventoryItemId: 'sample_inv_5',
    inventoryItemName: 'Lidocaine 2% w/ epi',
    costPrice: 185,
    quantity: 8,
  },
]

const SAMPLE_STOCK: Record<string, number> = {
  sample_inv_1: 12,
  sample_inv_2: 35,
  sample_inv_3: 5,
  sample_inv_4: 10,
  sample_inv_5: 3,
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const ghs = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'GHS' }).format(n)

function InventoryReconciliation({ monthLabel }: { monthLabel: string }) {
  const configQuery = useApiQuery<{ enabled: boolean } | null>(
    queryKeys.settings.kv('monthly_threshold_config'),
    () => api.get<{ enabled: boolean } | null>('/api/settings/kv/monthly_threshold_config')
  )
  const threshQuery = useApiQuery<{ items: ThresholdItem[] } | null>(
    queryKeys.settings.kv('monthly_threshold_items'),
    () => api.get<{ items: ThresholdItem[] } | null>('/api/settings/kv/monthly_threshold_items')
  )
  const invQuery = useApiQuery<{ id: string; stockQuantity: number }[]>(
    queryKeys.inventory.list(),
    () => api.get<{ id: string; stockQuantity: number }[]>('/api/inventory')
  )

  const loading = configQuery.isLoading || threshQuery.isLoading || invQuery.isLoading
  const enabled = configQuery.data?.enabled ?? false
  const items = threshQuery.data?.items ?? []
  const stockMap: Record<string, number> = {}
  for (const i of invQuery.data ?? []) stockMap[i.id] = i.stockQuantity

  if (loading) return null

  const usingSample = !enabled || items.length === 0
  const effectiveItems = usingSample ? SAMPLE_THRESHOLD_ITEMS : items
  const effectiveStock = usingSample ? SAMPLE_STOCK : stockMap

  const rows = effectiveItems.map((i) => ({
    ...i,
    currentStock: effectiveStock[i.inventoryItemId] ?? 0,
    needed: Math.max(0, i.quantity - (effectiveStock[i.inventoryItemId] ?? 0)),
  }))
  const topUpCount = rows.filter((r) => r.needed > 0).length
  const totalEstimatedCost = rows.reduce((s, r) => s + r.needed * r.costPrice, 0)

  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=900,height=700')
    if (!w) return
    const bodyRows = rows
      .map((r) => {
        const stockColor = r.needed > 0 ? '#b91c1c' : '#047857'
        const needColor = r.needed > 0 ? '#b91c1c' : '#9ca3af'
        const costColor = r.needed > 0 ? '#b91c1c' : '#9ca3af'
        return `
          <tr>
            <td>${escapeHtml(r.inventoryItemName)}</td>
            <td class="right num">${r.quantity}</td>
            <td class="right num" style="color:${stockColor};font-weight:500">${r.currentStock}</td>
            <td class="right num" style="color:${needColor};font-weight:600">${r.needed > 0 ? `+${r.needed}` : '—'}</td>
            <td class="right num" style="color:${costColor};font-weight:600">${r.needed > 0 ? escapeHtml(ghs(r.needed * r.costPrice)) : '—'}</td>
          </tr>`
      })
      .join('')
    const summaryLine =
      topUpCount === 0
        ? `<p style="color:#047857;font-weight:600;margin-top:12px">All items are at or above threshold.</p>`
        : `<p style="margin-top:12px"><strong style="color:#b91c1c">${topUpCount}</strong> ${topUpCount === 1 ? 'item needs' : 'items need'} to be topped up.</p>`
    const totalLine =
      totalEstimatedCost > 0
        ? `<p style="margin-top:4px">Total estimated top-up cost: <strong>${escapeHtml(ghs(totalEstimatedCost))}</strong></p>`
        : ''
    w.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Inventory Reconciliation — ${escapeHtml(monthLabel)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; padding: 32px; color: #111827; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      h2 { font-size: 14px; font-weight: 500; color: #6b7280; margin: 0 0 24px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      thead th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; padding: 8px 12px; border-bottom: 1px solid #d1d5db; }
      tbody td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
      .right { text-align: right; }
      .num { font-variant-numeric: tabular-nums; }
      p { font-size: 13px; color: #374151; margin: 0; }
      @media print { body { padding: 16px; } }
    </style>
  </head>
  <body>
    <h1>Inventory Reconciliation</h1>
    <h2>${escapeHtml(monthLabel)}${usingSample ? ' &middot; Sample data' : ''}</h2>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th class="right">Threshold</th>
          <th class="right">Current Stock</th>
          <th class="right">Top-up Needed</th>
          <th class="right">Estimated Cost</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
    ${summaryLine}
    ${totalLine}
    <script>
      window.addEventListener('load', () => { window.focus(); window.print(); });
      window.addEventListener('afterprint', () => window.close());
    </script>
  </body>
</html>`)
    w.document.close()
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Inventory Reconciliation</h2>
          {usingSample && (
            <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              Sample data
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={handlePrint}>
          <Printer className="mr-1.5 h-3.5 w-3.5" />
          Print
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        {usingSample
          ? 'Preview using sample data. Enable Monthly Threshold in Settings and add items in Inventory → Monthly Threshold to see real reconciliation.'
          : 'Monthly threshold vs current stock. Items below threshold need to be topped up for next month.'}
      </p>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Threshold</TableHead>
                <TableHead className="text-right">Current Stock</TableHead>
                <TableHead className="text-right">Top-up Needed</TableHead>
                <TableHead className="text-right">Estimated Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.inventoryItemName}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-medium ${r.needed > 0 ? 'text-destructive' : 'text-emerald-600'}`}
                  >
                    {r.currentStock}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-semibold ${r.needed > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {r.needed > 0 ? `+${r.needed}` : '—'}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-semibold ${r.needed > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {r.needed > 0 ? ghs(r.needed * r.costPrice) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          {topUpCount === 0 ? (
            <span className="text-emerald-600 font-medium">
              All items are at or above threshold.
            </span>
          ) : (
            <>
              <span className="text-destructive font-medium">{topUpCount}</span>{' '}
              {topUpCount === 1 ? 'item needs' : 'items need'} to be topped up.
            </>
          )}
        </p>
        {totalEstimatedCost > 0 && (
          <p className="text-muted-foreground">
            Total estimated top-up cost:{' '}
            <span className="font-semibold text-foreground">{ghs(totalEstimatedCost)}</span>
          </p>
        )}
      </div>
    </div>
  )
}
