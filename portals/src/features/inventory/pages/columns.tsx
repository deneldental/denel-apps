import type { Column, ColumnDef } from '@tanstack/react-table'
import {
  Check,
  ChevronsUpDown,
  Eye,
  MoreHorizontal,
  Pencil,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { AdjustStockSheet } from '@/features/inventory/components/adjust-stock-sheet'
import { EditInventorySheet } from '@/features/inventory/components/edit-inventory-sheet'
import { deleteInventoryItem } from '@/lib/actions/inventory'
import type { items } from '@/lib/db/schema'
import { cn } from '@/lib/utils'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { useLookup } from '@/shared/hooks/use-lookup'

export type Product = typeof items.$inferSelect

function CategoryFilter({ column }: { column: Column<Product> }) {
  const selectedValues = new Set((column.getFilterValue() as string[]) || [])
  // Shared categories lookup — refreshes when Settings → Categories is edited.
  const { rows: categoryRows } = useLookup('categories')
  const categories = categoryRows.map((c) => c.name)

  if (categories.length === 0) {
    return null
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-8 border-dashed">
          Category
          {selectedValues.size > 0 && (
            <Badge variant="secondary" className="ml-2 rounded-sm px-1 font-normal">
              {selectedValues.size}
            </Badge>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <div className="p-2">
          {categories.map((category) => {
            const isSelected = selectedValues.has(category)
            return (
              <div
                key={category}
                className="flex items-center space-x-2 cursor-pointer hover:bg-accent rounded-sm p-1.5"
                onClick={() => {
                  const newValues = new Set(selectedValues)
                  if (isSelected) {
                    newValues.delete(category)
                  } else {
                    newValues.add(category)
                  }
                  column.setFilterValue(newValues.size > 0 ? Array.from(newValues) : undefined)
                }}
              >
                <div
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                    isSelected
                      ? 'bg-primary text-primary-foreground'
                      : 'opacity-50 [&_svg]:invisible'
                  )}
                >
                  <Check className="h-3 w-3" />
                </div>
                <span className="text-sm capitalize">{category}</span>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ProductActions({
  product,
  onView,
  canEdit = true,
  onReload,
}: {
  product: Product
  onView: () => void
  canEdit?: boolean
  onReload: () => void
}) {
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showAdjust, setShowAdjust] = useState(false)

  const confirmDelete = async () => {
    const result = await deleteInventoryItem(product.id)
    if (result.success) {
      toast.success('Inventory item deleted successfully')
      setShowDeleteDialog(false)
      onReload()
    } else {
      toast.error(result.error || 'Failed to delete inventory item')
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
              onView()
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
            disabled={!canEdit}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              setShowAdjust(true)
            }}
            disabled={!canEdit}
          >
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Adjust stock
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              setShowDeleteDialog(true)
            }}
            className="text-destructive"
            disabled={!canEdit}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
        onConfirm={confirmDelete}
        title="Delete inventory item?"
        description="The item will be removed from inventory."
        itemName={product.name}
      />
    </>
  )
}

export const getColumns = (
  onView: (id: string) => void,
  canEdit: boolean,
  onReload: () => void
): ColumnDef<Product>[] => [
  {
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Item Name" />,
    cell: ({ row }) => {
      return <div className="font-medium">{row.getValue('name')}</div>
    },
  },
  {
    id: 'location',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Location" />,
    cell: ({ row }) => {
      const location = (row.original as unknown as { location?: string | null }).location
      return <span className="text-sm text-muted-foreground">{location ?? '—'}</span>
    },
  },
  {
    accessorKey: 'unit',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Unit" />,
    cell: ({ row }) => {
      const unit = row.getValue('unit') as string
      return <div className="uppercase text-sm">{unit || '-'}</div>
    },
  },
  {
    accessorKey: 'category',
    header: ({ column }) => (
      <div className="flex items-center gap-2">
        <DataTableColumnHeader column={column} title="Category" />
        <CategoryFilter column={column} />
      </div>
    ),
    cell: ({ row }) => {
      const category = row.getValue('category') as string
      return (
        <Badge variant="outline" className="capitalize">
          {category || '-'}
        </Badge>
      )
    },
    filterFn: (row, id, value) => {
      if (!value || value.length === 0) return true
      const category = row.getValue(id) as string
      return value.includes(category)
    },
  },
  {
    accessorKey: 'stockQuantity',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Quantity" />,
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
    accessorKey: 'sku',
    header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
    cell: ({ row }) => {
      return <div className="font-mono text-xs">{row.getValue('sku') || '-'}</div>
    },
    enableHiding: true,
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      return (
        <ProductActions
          product={row.original}
          onView={() => onView(row.original.id)}
          canEdit={canEdit}
          onReload={onReload}
        />
      )
    },
  },
]
