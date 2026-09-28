import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { deleteProduct } from '@/lib/actions/products'
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
import { formatAmount } from '@/shared/utils/currency'
import { EditProductSheet } from '../components/edit-product-sheet'
import type { Product } from './columns'

interface AuditLog {
  id: string
  action: string
  changedFields: string[] | null
  createdAt: string
  user?: { id: string; name: string } | null
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // See inventory-detail-content: `audit_logs` is a separate grant from the
  // stock modules, so the Activity Log only renders for roles that hold it.
  const canReadAuditLog = useCan('audit_logs', 'read')

  const productQuery = useApiQuery<Product>(
    queryKeys.products.detail(id ?? ''),
    () => api.get<Product>(`/api/products/${id}`),
    { enabled: !!id }
  )
  const product = productQuery.data ?? null
  const loading = productQuery.isLoading

  // No id, or the product doesn't exist / isn't ours to see — bounce back,
  // same as the original's early-return-and-navigate.
  useEffect(() => {
    if (!id || productQuery.isError) {
      navigate('/inventory/products')
    }
  }, [id, productQuery.isError, navigate])

  // Keyed on product.updatedAt too: an edit writes an audit row, so the
  // history below must refresh alongside the item itself.
  const logsQuery = useApiQuery<AuditLog[]>(
    ['audit-logs', 'products', id ?? '', product?.updatedAt] as const,
    () => api.get<AuditLog[]>(`/api/audit-logs?entityId=${id}&module=products&limit=50`),
    { enabled: canReadAuditLog && !!id && !!product }
  )
  const logs = logsQuery.data ?? []
  const logsLoading = logsQuery.isLoading

  const deleteMutation = useApiMutation((productId: string) => deleteProduct(productId), {
    invalidates: [queryKeys.products.all],
  })

  async function handleDelete() {
    if (!product) return
    try {
      await deleteMutation.mutateAsync(product.id)
      toast.success('Product deleted')
      navigate('/inventory/products')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete product')
    }
  }

  if (loading || !product) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const sellingPrice = Number(product.price ?? 0)
  const costPrice = product.costPrice != null ? Number(product.costPrice) : null
  const profit = costPrice != null ? sellingPrice - costPrice : null
  const profitMargin =
    costPrice && costPrice > 0 && profit != null
      ? `${((profit / costPrice) * 100).toFixed(1)}%`
      : '—'
  const reorderLevel = product.reorderLevel ?? 10
  const stockQty = product.stockQuantity ?? 0

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/inventory/products">Product Inventory</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{product.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => navigate('/inventory/products')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {/* Product card */}
      <div className="rounded-lg border border-border p-6 space-y-6">
        {product.image && (
          <div>
            <div className="aspect-square max-w-xs rounded-lg overflow-hidden border border-muted">
              <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
              Name
            </p>
            <p className="font-semibold">{product.name}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">SKU</p>
            <p className="font-mono text-sm">{product.sku || '—'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
              Category
            </p>
            <Badge variant="outline" className="capitalize">
              {product.category || '—'}
            </Badge>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
              Selling Price
            </p>
            <p className="font-semibold">GHS {formatAmount(Number(sellingPrice))}</p>
          </div>
          {costPrice != null && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                Cost Price
              </p>
              <p>GHS {formatAmount(Number(costPrice))}</p>
            </div>
          )}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
              Profit Margin
            </p>
            <p>{profitMargin}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
              Stock Qty
            </p>
            <p className={`font-semibold ${stockQty <= reorderLevel ? 'text-destructive' : ''}`}>
              {stockQty}
              {stockQty === 0 && (
                <Badge variant="destructive" className="ml-2 text-[10px]">
                  Out of stock
                </Badge>
              )}
              {stockQty > 0 && stockQty <= reorderLevel && (
                <Badge variant="warning" className="ml-2 text-[10px]">
                  Low
                </Badge>
              )}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
              Reorder Level
            </p>
            <p>{reorderLevel}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
              Unit
            </p>
            <p>{product.unit || '—'}</p>
          </div>
          {(product.sizeValue || product.sizeUnit) && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                Size
              </p>
              <p>{[product.sizeValue, product.sizeUnit].filter(Boolean).join(' ')}</p>
            </div>
          )}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
              Per Pack
            </p>
            <p>{product.quantityPerPack ?? 1}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border text-sm text-muted-foreground">
          <div>Created {format(new Date(product.createdAt), 'PPp')}</div>
          <div>Updated {format(new Date(product.updatedAt), 'PPp')}</div>
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
                      No activity recorded yet.
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

      <EditProductSheet
        product={product}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: queryKeys.products.all })}
      />

      <DeleteConfirmationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title="Delete Product"
        description={`Delete "${product.name}"? This cannot be undone.`}
        itemName={product.name}
      />
    </div>
  )
}
