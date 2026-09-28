import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { AddInventorySheet } from '@/features/inventory/components/add-inventory-sheet'
import { InventoryLockToggle } from '@/features/inventory/components/inventory-lock-toggle'
import { ReceiveStockSheet } from '@/features/inventory/components/receive-stock-sheet'
import { expiryStatus, VALUATION_METHOD_LABELS } from '@/features/inventory/policies'
import { useInventoryPolicies } from '@/features/inventory/use-inventory-policies'
import {
  getInventoryBatches,
  getInventoryItems,
  getInventoryValuation,
} from '@/lib/actions/inventory'
import { getInventoryLockStatus } from '@/lib/actions/settings'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { formatCurrency } from '@/shared/utils/currency'
import { InventoryClient } from './inventory-client'

const PAGE_LIMIT = 50
// Distinct from products' lock key even though both read the same
// `/api/settings/locks` endpoint — each extracts a different sub-field, so
// sharing the bare `queryKeys.settings.locks()` key would let one page's
// cached shape leak into the other's.
const INVENTORY_LOCK_KEY = ['settings', 'locks', 'inventory'] as const

export default function InventoryPage() {
  const queryClient = useQueryClient()
  const [offset, setOffset] = useState(0)
  // Receive sheet state
  const [receiveOpen, setReceiveOpen] = useState(false)
  // Expiring-soon tab — only fetched once the tab is actually opened.
  const [batchesEnabled, setBatchesEnabled] = useState(false)

  const filters = { limit: PAGE_LIMIT, offset }
  const inventoryQuery = useApiQuery(queryKeys.inventory.list(filters), async () => {
    const res = await getInventoryItems(filters)
    return {
      success: res.success,
      data: { rows: res.data ?? [], total: res.total },
      error: res.error,
    }
  })
  const inventoryItems = inventoryQuery.data?.rows ?? []
  const total = inventoryQuery.data?.total ?? 0
  const loading = inventoryQuery.isLoading
  const error = inventoryQuery.isError ? inventoryQuery.error.message : null

  const lockStatusQuery = useApiQuery(INVENTORY_LOCK_KEY, () => getInventoryLockStatus())
  const lockStatus = lockStatusQuery.data ?? { isLocked: false, isAdmin: false }

  // Settings → Inventory → Store Policies drives the expiring window, the
  // critical highlight and the valuation method (settings-domain-audit S5-B).
  const { policies } = useInventoryPolicies()
  const expiringDays = policies.expiryWarningDays
  const valuationQuery = useApiQuery(queryKeys.inventory.valuation(), getInventoryValuation)
  const valuation = valuationQuery.data ?? null

  // After an add/receive/edit/delete elsewhere, refresh every cached page +
  // the low/out-of-stock views derived from them.
  // Stable, so the inventory list keeps its row actions (and open sheets) mounted.
  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
  }, [queryClient])

  const batchesQuery = useQuery({
    queryKey: queryKeys.inventory.batches({ expiringDays }),
    queryFn: () => getInventoryBatches({ expiringDays }),
    enabled: batchesEnabled,
  })
  const batches = batchesQuery.data?.data ?? []
  const batchesLoading = batchesQuery.isFetching
  const criticalCount = batches.filter(
    (b) => expiryStatus(b.expiryDate, policies).level === 'critical'
  ).length

  const lowStock = useMemo(
    () =>
      inventoryItems.filter(
        (item) => item.stockQuantity <= (item.reorderLevel ?? 10) && item.stockQuantity > 0
      ),
    [inventoryItems]
  )

  const outOfStock = useMemo(
    () => inventoryItems.filter((item) => item.stockQuantity === 0),
    [inventoryItems]
  )

  const totalPages = Math.ceil(total / PAGE_LIMIT)
  const currentPage = Math.floor(offset / PAGE_LIMIT) + 1

  function handlePrev() {
    if (offset === 0) return
    setOffset(Math.max(0, offset - PAGE_LIMIT))
  }

  function handleNext() {
    if (offset + PAGE_LIMIT >= total) return
    setOffset(offset + PAGE_LIMIT)
  }

  if (loading) return null

  if (error) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  const canEdit = !lockStatus.isLocked || lockStatus.isAdmin

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground">Manage clinic inventory items and stock.</p>
        </div>
        <div className="flex items-center gap-3">
          <InventoryLockToggle isLocked={lockStatus.isLocked} isAdmin={lockStatus.isAdmin} />
          <Button variant="outline" onClick={() => setReceiveOpen(true)} disabled={!canEdit}>
            Receive Stock
          </Button>
          <AddInventorySheet buttonText="Add Item" disabled={!canEdit} onSaved={refreshAll} />
        </div>
      </div>

      {valuation && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-muted-foreground">Stock value</span>
          <span className="text-lg font-semibold tabular-nums">
            {formatCurrency(valuation.totalValue)}
          </span>
          <span className="text-xs text-muted-foreground">
            {VALUATION_METHOD_LABELS[valuation.method]} · {valuation.itemCount} item
            {valuation.itemCount === 1 ? '' : 's'} in stock
          </span>
        </div>
      )}

      <Tabs
        defaultValue="all"
        onValueChange={(tab) => {
          if (tab === 'expiring-soon') setBatchesEnabled(true)
        }}
      >
        <TabsList>
          <TabsTrigger value="all">
            All items
            <Badge variant="secondary" className="ml-2 text-[10px]">
              {total > 0 ? total : inventoryItems.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="low-stock">
            Low stock
            {lowStock.length > 0 && (
              <Badge variant="warning" className="ml-2 text-[10px]">
                {lowStock.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="out-of-stock">
            Out of stock
            {outOfStock.length > 0 && (
              <Badge variant="destructive" className="ml-2 text-[10px]">
                {outOfStock.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="expiring-soon">
            Expiring soon
            {batches.length > 0 && (
              <Badge
                variant={criticalCount > 0 ? 'destructive' : 'warning'}
                className="ml-2 text-[10px]"
              >
                {batches.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <InventoryClient products={inventoryItems} canEdit={canEdit} onReload={refreshAll} />
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-3 mt-4">
              <p className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </p>
              <Button variant="outline" size="sm" onClick={handlePrev} disabled={offset === 0}>
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNext}
                disabled={offset + PAGE_LIMIT >= total}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="low-stock" className="mt-4">
          {lowStock.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No items are running low.
            </p>
          ) : (
            <InventoryClient products={lowStock} canEdit={canEdit} onReload={refreshAll} />
          )}
        </TabsContent>

        <TabsContent value="out-of-stock" className="mt-4">
          {outOfStock.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              All items are in stock.
            </p>
          ) : (
            <InventoryClient products={outOfStock} canEdit={canEdit} onReload={refreshAll} />
          )}
        </TabsContent>

        <TabsContent value="expiring-soon" className="mt-4">
          {batchesLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading batches…</p>
          ) : batches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No batches expiring within {expiringDays} days.
            </p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Item</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Location
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Qty Remaining
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Unit Cost
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Expiry Date
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Lot Number
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {batches.map((batch) => {
                    const expiry = batch.expiryDate ? new Date(batch.expiryDate) : null
                    const { daysUntil: daysUntilExpiry, level } = expiryStatus(
                      batch.expiryDate,
                      policies
                    )
                    const isUrgent = level === 'critical'
                    return (
                      <tr key={batch.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">{batch.itemName}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {batch.locationName ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{batch.qtyRemaining}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {batch.unitCost != null ? formatCurrency(batch.unitCost) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {expiry ? (
                            <span className={isUrgent ? 'text-destructive font-medium' : ''}>
                              {expiry.toLocaleDateString('en-GH', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })}
                              {daysUntilExpiry !== null && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  ({daysUntilExpiry}d)
                                </span>
                              )}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {batch.lotNumber ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ReceiveStockSheet open={receiveOpen} onOpenChange={setReceiveOpen} onSaved={refreshAll} />
    </div>
  )
}
