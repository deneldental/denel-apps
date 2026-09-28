import { format } from 'date-fns'
import { Calendar } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getDailySales } from '@/lib/actions/sales'
import type { items, sales } from '@/lib/db/schema'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { formatCurrency } from '@/shared/utils/currency'

type Sale = typeof sales.$inferSelect
type Product = typeof items.$inferSelect

interface SalesItem {
  sale: Sale
  product: Product | null
}

import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteSale, updateSale } from '@/lib/actions/sales'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

interface SalesViewProps {
  /** When true, hide the date picker, edit/delete actions and the edit dialog. */
  readOnly?: boolean
  /** ISO yyyy-mm-dd date to load on mount. Defaults to today. */
  initialDate?: string
}

export function SalesView({ readOnly = false, initialDate }: SalesViewProps = {}) {
  const [selectedDate, setSelectedDate] = useState<string>(
    initialDate || format(new Date(), 'yyyy-MM-dd')
  )

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Edit State
  const [editingItem, setEditingItem] = useState<SalesItem | null>(null)
  const [editQuantity, setEditQuantity] = useState<string>('')
  const [deleteTarget, setDeleteTarget] = useState<SalesItem | null>(null)

  const DAILY_KEY = queryKeys.sales.daily(selectedDate)
  const salesQuery = useApiQuery<SalesItem[]>(DAILY_KEY, () =>
    getDailySales(new Date(selectedDate))
  )
  const salesData = salesQuery.data ?? []
  const isLoading = salesQuery.isLoading

  useEffect(() => {
    if (salesQuery.isError) {
      toast.error(salesQuery.error.message || 'Failed to load sales')
    }
  }, [salesQuery.isError, salesQuery.error])

  // A write to any day's sales should also refresh the 30-day aggregate in
  // sales.tsx, so invalidate the whole group rather than just this day's key.
  const updateMutation = useApiMutation(
    (vars: { id: string; quantity: number }) => updateSale(vars.id, { quantity: vars.quantity }),
    { invalidates: [queryKeys.sales.all] }
  )
  const isUpdating = updateMutation.isPending

  const deleteMutation = useApiMutation((id: string) => deleteSale(id), {
    invalidates: [queryKeys.sales.all],
  })

  const summary = useMemo(
    () =>
      salesData.reduce(
        (acc, item) => {
          acc.totalSales += item.sale.totalAmount
          acc.totalProfit += item.sale.profit > 0 ? item.sale.profit : 0
          acc.totalLoss += item.sale.profit < 0 ? Math.abs(item.sale.profit) : 0
          acc.totalItems += item.sale.quantity
          return acc
        },
        { totalSales: 0, totalProfit: 0, totalLoss: 0, totalItems: 0 }
      ),
    [salesData]
  )

  const handleEditClick = (item: SalesItem) => {
    setEditingItem(item)
    setEditQuantity(item.sale.quantity.toString())
  }

  const handleUpdateQuantity = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingItem) return

    const qty = parseInt(editQuantity, 10)
    if (Number.isNaN(qty) || qty < 1) {
      toast.error('Quantity must be at least 1')
      return
    }

    try {
      await updateMutation.mutateAsync({ id: editingItem.sale.id, quantity: qty })
      toast.success('Sale quantity updated')
      setEditingItem(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update sale')
    }
  }

  const confirmDeleteSale = async () => {
    if (!deleteTarget) return
    const loadingId = toast.loading('Removing item...')
    try {
      await deleteMutation.mutateAsync(deleteTarget.sale.id)
      toast.success('Item removed from queue', { id: loadingId })
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove', { id: loadingId })
      throw new Error('delete failed')
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed off selectedDate, not page
  useEffect(() => {
    setCurrentPage(1) // Reset to first page when date changes
  }, [selectedDate])

  return (
    <div className="space-y-6">
      {/* Date Selector */}
      {!readOnly && (
        <Card>
          <CardHeader>
            <CardTitle>Select Date</CardTitle>
            <CardDescription>View sales for a specific date</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="space-y-2">
                <Label htmlFor="sale-date">Date</Label>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <Input
                    id="sale-date"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-[200px]"
                  />
                </div>
              </div>
              <Button onClick={() => salesQuery.refetch()} disabled={isLoading}>
                Load Sales
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Sales</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.totalSales)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Profit</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(summary.totalProfit)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Loss</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(summary.totalLoss)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Items Sold</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalItems}</div>
          </CardContent>
        </Card>
      </div>

      {/* Sales Table */}
      <Card>
        <CardHeader>
          <CardTitle>Sales Details</CardTitle>
          <CardDescription>
            Sales for {format(new Date(selectedDate), 'MMMM d, yyyy')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading sales...</div>
          ) : salesData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No sales found for this date
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Unit Price</TableHead>
                    <TableHead>Cost Price</TableHead>
                    <TableHead>Total Amount</TableHead>
                    <TableHead>Profit/Loss</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                    {!readOnly && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesData
                    .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                    .map((item) => {
                      const isProfit = item.sale.profit >= 0
                      return (
                        <TableRow key={item.sale.id}>
                          <TableCell className="font-medium">
                            {item.product?.name || 'Unknown Product'}
                          </TableCell>
                          <TableCell>{item.sale.quantity}</TableCell>
                          <TableCell>{formatCurrency(item.sale.unitPrice)}</TableCell>
                          <TableCell>{formatCurrency(item.sale.costPrice)}</TableCell>
                          <TableCell className="font-medium">
                            {formatCurrency(item.sale.totalAmount)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={isProfit ? 'default' : 'destructive'}>
                              {isProfit ? '+' : ''}
                              {formatCurrency(item.sale.profit)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(item.sale.saleDate), 'h:mm a')}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={item.sale.status === 'draft' ? 'outline' : 'secondary'}
                              className="capitalize"
                            >
                              {item.sale.status || 'draft'}
                            </Badge>
                          </TableCell>
                          {!readOnly && (
                            <TableCell className="text-right">
                              {(item.sale.status === 'draft' || !item.sale.status) && (
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleEditClick(item)}
                                    aria-label="Edit"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={() => setDeleteTarget(item)}
                                    aria-label="Delete"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                </TableBody>
              </Table>

              {/* Pagination Controls */}
              {salesData.length > itemsPerPage && (
                <div className="flex items-center justify-between space-x-2 py-4 mt-4 border-t">
                  <div className="text-sm text-muted-foreground pl-2">
                    Showing {(currentPage - 1) * itemsPerPage + 1} to{' '}
                    {Math.min(currentPage * itemsPerPage, salesData.length)} of {salesData.length}{' '}
                    entries
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((prev) =>
                          Math.min(prev + 1, Math.ceil(salesData.length / itemsPerPage))
                        )
                      }
                      disabled={currentPage >= Math.ceil(salesData.length / itemsPerPage)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Edit Quantity Dialog */}
      <Dialog
        open={!readOnly && !!editingItem}
        onOpenChange={(open) => !open && setEditingItem(null)}
      >
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleUpdateQuantity}>
            <DialogHeader>
              <DialogTitle>Update Sale Quantity</DialogTitle>
              <DialogDescription>
                Adjust the quantity for {editingItem?.product?.name}.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-quantity">Quantity (Packs/Items)</Label>
                <Input
                  id="edit-quantity"
                  type="number"
                  min="1"
                  value={editQuantity}
                  onChange={(e) => setEditQuantity(e.target.value)}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingItem(null)}
                disabled={isUpdating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isUpdating}>
                {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onConfirm={confirmDeleteSale}
        title="Remove item from sales queue?"
        description="The sale will be removed from the daily queue."
        itemName={deleteTarget?.product?.name ?? 'this sale'}
        confirmLabel="Remove"
      />
    </div>
  )
}
