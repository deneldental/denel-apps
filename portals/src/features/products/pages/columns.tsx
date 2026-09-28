import type { ColumnDef } from '@tanstack/react-table'
import { Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EditProductSheet } from '@/features/products/components/edit-product-sheet'
import { ViewProductSheet } from '@/features/products/components/view-product-sheet'
import { deleteProduct } from '@/lib/actions/products'
import type { items } from '@/lib/db/schema'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { formatCurrency } from '@/shared/utils/currency'

export type Product = typeof items.$inferSelect

function ProductActions({ product, onReload }: { product: Product; onReload: () => void }) {
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showViewSheet, setShowViewSheet] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const confirmDelete = async () => {
    const result = await deleteProduct(product.id)
    if (result.success) {
      toast.success('Product deleted successfully')
      setShowDeleteDialog(false)
      onReload()
    } else {
      toast.error(result.error || 'Failed to delete product')
      throw new Error('delete failed')
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Open menu</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              setShowViewSheet(true)
            }}
          >
            <Eye className="mr-2 h-4 w-4" />
            View
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              setShowEditDialog(true)
            }}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              setShowDeleteDialog(true)
            }}
            className="text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditProductSheet
        product={product}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onSuccess={onReload}
      />
      <ViewProductSheet
        product={product}
        open={showViewSheet}
        onOpenChange={setShowViewSheet}
        onEdit={() => {
          setShowViewSheet(false)
          setShowEditDialog(true)
        }}
      />
      <DeleteConfirmationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={confirmDelete}
        title="Delete product?"
        description="The product will be removed from the catalogue."
        itemName={product.name}
      />
    </>
  )
}

export const getColumns = (onReload: () => void): ColumnDef<Product>[] => [
  {
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Product Name" />,
    cell: ({ row }) => {
      return <div className="font-medium">{row.getValue('name')}</div>
    },
  },
  {
    accessorKey: 'sku',
    header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
    cell: ({ row }) => {
      return <div className="font-mono text-xs">{row.getValue('sku') || '-'}</div>
    },
  },
  {
    id: 'size',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Size" />,
    cell: ({ row }) => {
      const sizeValue = row.original.sizeValue
      const sizeUnit = row.original.sizeUnit
      if (sizeValue || sizeUnit) {
        const label =
          `${sizeValue ?? ''}${sizeValue && sizeUnit ? ' ' : ''}${sizeUnit ?? ''}`.trim()
        return <div className="text-muted-foreground">{label}</div>
      }
      return <div className="text-muted-foreground">—</div>
    },
  },
  {
    accessorKey: 'category',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
    cell: ({ row }) => {
      return <div className="capitalize">{row.getValue('category') || '-'}</div>
    },
  },
  {
    accessorKey: 'costPrice',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Cost Price" />,
    cell: ({ row }) => {
      const amount = Number(row.getValue('costPrice') || 0)
      return <div className="text-muted-foreground">{formatCurrency(amount)}</div>
    },
  },
  {
    accessorKey: 'price',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Selling Price" />,
    cell: ({ row }) => {
      const amount = Number(row.getValue('price') || 0)
      return <div className="font-medium">{formatCurrency(amount)}</div>
    },
  },
  {
    id: 'profit',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Profit/Loss" />,
    cell: ({ row }) => {
      const costPrice = Number(row.original.costPrice || 0)
      const sellingPrice = Number(row.original.price || 0)
      const profit = sellingPrice - costPrice
      const profitMargin = costPrice > 0 ? ((profit / costPrice) * 100).toFixed(1) : '0.0'

      return (
        <div className={`font-medium ${profit >= 0 ? 'text-green-600' : 'text-destructive'}`}>
          {formatCurrency(profit)} ({profitMargin}%)
        </div>
      )
    },
  },
  {
    accessorKey: 'stockQuantity',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Stock" />,
    cell: ({ row }) => {
      const quantity = row.getValue('stockQuantity') as number
      const reorderLevel = row.original.reorderLevel || 10
      return (
        <div className={`font-medium ${quantity <= reorderLevel ? 'text-destructive' : ''}`}>
          {quantity}
        </div>
      )
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => <ProductActions product={row.original} onReload={onReload} />,
  },
]
