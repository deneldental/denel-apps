import { format } from 'date-fns'
import type { Product } from '@/features/inventory/pages/columns'
import { Badge } from '@/shared/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

interface ViewInventoryDialogProps {
  product: Product | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ViewInventoryDialog({ product, open, onOpenChange }: ViewInventoryDialogProps) {
  if (!product) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Inventory Item Details</DialogTitle>
          <DialogDescription>View details for {product.name}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          {product.image && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Image</h3>
              <div className="aspect-square max-w-xs rounded-lg overflow-hidden border border-muted">
                <img
                  src={product.image}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Item Name</p>
              <p className="text-sm font-medium">{product.name}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Unit</p>
              <p className="text-sm uppercase">{product.unit || '-'}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Category</p>
              <Badge variant="outline" className="capitalize w-fit">
                {product.category || '-'}
              </Badge>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Quantity</p>
              <p
                className={`text-sm font-medium ${product.stockQuantity <= (product.reorderLevel || 10) ? 'text-destructive' : ''}`}
              >
                {product.stockQuantity}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Reorder Level</p>
              <p className="text-sm">{product.reorderLevel || 10}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">SKU</p>
              <p className="text-sm font-mono text-xs">{product.sku || '-'}</p>
            </div>
          </div>
          {product.description && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Description</p>
              <p className="text-sm">{product.description}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Created</p>
              <p className="text-sm">{format(new Date(product.createdAt), 'PPp')}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Last Updated</p>
              <p className="text-sm">{format(new Date(product.updatedAt), 'PPp')}</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
