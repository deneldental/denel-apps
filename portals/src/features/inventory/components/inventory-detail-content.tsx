import { format } from 'date-fns'
import { ArrowLeft, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { Product } from '@/features/inventory/pages/columns'
import { VALUATION_METHOD_LABELS, type ValuationMethod } from '@/features/inventory/policies'
import { deleteInventoryItem } from '@/lib/actions/inventory'
import { api } from '@/lib/api-client'
import { useCan } from '@/lib/permissions-context'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/shared/components/ui/breadcrumb'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { formatCurrency } from '@/shared/utils/currency'
import { AdjustStockSheet } from './adjust-stock-sheet'
import { EditInventorySheet } from './edit-inventory-sheet'

interface AuditLog {
  id: string
  action: string
  module: string
  entityId: string
  changedFields: string[] | null
  createdAt: string
  user?: { id: string; name: string; email: string } | null
}

interface InventoryDetailContentProps {
  /** GET /api/inventory/:id adds the stock value under the configured method (S5-B). */
  product: Product & { stockValue?: number; valuationMethod?: ValuationMethod }
  /** Refetches the item after an edit so the page reflects what was saved. */
  onReload?: () => void
}

export function InventoryDetailContent({ product, onReload }: InventoryDetailContentProps) {
  const navigate = useNavigate()
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showAdjust, setShowAdjust] = useState(false)
  // The audit trail is its own module — stock roles that write these rows don't
  // necessarily get to read them back, so don't render an Activity Log that 403s.
  const canReadAuditLog = useCan('audit_logs', 'read')

  // Keyed on product.updatedAt too: an edit writes an audit row, so the
  // history below must refresh alongside the item itself.
  const logsQuery = useApiQuery<AuditLog[]>(
    ['audit-logs', 'inventory', product.id, product.updatedAt] as const,
    () => api.get<AuditLog[]>(`/api/audit-logs?entityId=${product.id}&module=inventory&limit=50`),
    { enabled: canReadAuditLog }
  )
  const logs = logsQuery.data ?? []
  const logsLoading = logsQuery.isLoading

  const deleteMutation = useApiMutation((id: string) => deleteInventoryItem(id), {
    invalidates: [queryKeys.inventory.all],
  })

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(product.id)
      toast.success('Inventory item deleted successfully')
      navigate('/inventory')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete inventory item')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumbs */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/inventory">Inventory</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{product.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => navigate('/inventory')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Inventory
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAdjust(true)}>
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Adjust stock
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowEditDialog(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {/* Item card */}
      <div className="rounded-lg border border-border p-6 grid gap-6">
        {product.image && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Image</h3>
            <div className="aspect-square max-w-xs rounded-lg overflow-hidden border border-muted">
              <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Item Name
            </p>
            <p className="text-lg font-semibold">{product.name}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Unit
            </p>
            <p className="text-lg uppercase">{product.unit || '—'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Category
            </p>
            <Badge variant="outline" className="capitalize w-fit">
              {product.category || '—'}
            </Badge>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Quantity
            </p>
            <p
              className={`text-lg font-semibold ${product.stockQuantity <= (product.reorderLevel || 10) ? 'text-destructive' : ''}`}
            >
              {product.stockQuantity}
              {product.stockQuantity === 0 && (
                <Badge variant="destructive" className="ml-2 text-[10px]">
                  Out of stock
                </Badge>
              )}
              {product.stockQuantity > 0 &&
                product.stockQuantity <= (product.reorderLevel || 10) && (
                  <Badge variant="warning" className="ml-2 text-[10px]">
                    Low stock
                  </Badge>
                )}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Stock Value
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {product.stockValue != null ? formatCurrency(product.stockValue) : '—'}
              {product.valuationMethod && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {VALUATION_METHOD_LABELS[product.valuationMethod]}
                </span>
              )}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Reorder Level
            </p>
            <p className="text-lg">{product.reorderLevel || 10}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">SKU</p>
            <p className="font-mono text-sm">{product.sku || '—'}</p>
          </div>
        </div>

        {product.description && (
          <div className="space-y-1 pt-4 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Description
            </p>
            <p className="text-sm">{product.description}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Created
            </p>
            <p className="text-sm">{format(new Date(product.createdAt), 'PPp')}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Last Updated
            </p>
            <p className="text-sm">{format(new Date(product.updatedAt), 'PPp')}</p>
          </div>
        </div>
      </div>

      {/* Activity log */}
      {canReadAuditLog && (
        <div>
          <h2 className="text-base font-semibold mb-3">Activity Log</h2>
          <div className="rounded-lg border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Changed Fields</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      No activity recorded for this item.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Badge
                          variant={
                            log.action === 'delete'
                              ? 'destructive'
                              : log.action === 'create'
                                ? 'success'
                                : 'secondary'
                          }
                          className="capitalize text-[10px]"
                        >
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {log.changedFields?.join(', ') || '—'}
                      </TableCell>
                      <TableCell className="text-sm">{log.user?.name || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(log.createdAt), 'MMM d, h:mm a')}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <EditInventorySheet
        product={product}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onSaved={onReload}
      />
      <AdjustStockSheet
        product={product}
        open={showAdjust}
        onOpenChange={setShowAdjust}
        onSaved={onReload}
      />
      <DeleteConfirmationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDelete}
        title="Delete Inventory Item"
        description={`Are you sure you want to delete "${product.name}"? This action cannot be undone.`}
      />
    </div>
  )
}
