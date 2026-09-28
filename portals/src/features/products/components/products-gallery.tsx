import { ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import { todaySalesCart, useTodaySalesCart } from '@/features/products/hooks/use-today-sales-cart'
import type { Product } from '@/features/products/pages/columns'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import { formatCurrency } from '@/shared/utils/currency'

interface ProductsGalleryProps {
  products: Product[]
  canEdit?: boolean
}

export function ProductsGallery({ products, canEdit = true }: ProductsGalleryProps) {
  const cart = useTodaySalesCart()

  const handleAddSale = (product: Product) => {
    if ((product.price || 0) <= 0) {
      toast.error('Product has no price. Cannot add to sales.')
      return
    }

    const totalUnits = (product.stockQuantity || 0) * (product.quantityPerPack || 1)
    const inCart = cart.items.find((i) => i.productId === product.id)?.quantity ?? 0
    if (inCart + 1 > totalUnits) {
      toast.error('Insufficient stock to add another unit.')
      return
    }

    todaySalesCart.add({
      productId: product.id,
      name: product.name,
      unitPrice: product.price ?? 0,
      costPrice: product.costPrice || 0,
    })
    toast.success(`${product.name} added to today's sales`)
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 w-full">
      {products.map((product) => {
        const sizeLabel =
          product.sizeValue || product.sizeUnit
            ? `${product.sizeValue ?? ''}${product.sizeValue && product.sizeUnit ? ' ' : ''}${product.sizeUnit ?? ''}`.trim()
            : '—'
        const totalUnits = (product.stockQuantity || 0) * (product.quantityPerPack || 1)
        const inCart = cart.items.find((i) => i.productId === product.id)?.quantity ?? 0
        const remaining = totalUnits - inCart

        return (
          <Card
            key={product.id}
            className="flex flex-col hover:shadow-lg transition-shadow h-full overflow-hidden"
          >
            {product.image && (
              <div className="aspect-square w-full overflow-hidden rounded-t-lg flex-shrink-0">
                <img
                  src={product.image}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <CardHeader className="flex-shrink-0 p-5 pb-3">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base sm:text-lg break-words hyphens-auto">
                  {product.name}
                </CardTitle>
                <span
                  className="inline-flex items-center rounded-md border bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground whitespace-nowrap flex-shrink-0"
                  title="Product size"
                >
                  {sizeLabel}
                </span>
              </div>
              {product.description && (
                <CardDescription className="break-words line-clamp-2 sm:line-clamp-3 text-xs sm:text-sm mt-2">
                  {product.description}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="flex-grow p-5 pt-3 min-h-0">
              <div className="space-y-2 sm:space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:justify-between gap-1 text-xs sm:text-sm">
                  <span className="text-muted-foreground whitespace-nowrap">Selling Price:</span>
                  <span className="font-medium break-words">
                    {formatCurrency(product.price ?? 0)}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between gap-1 text-xs sm:text-sm">
                  <span className="text-muted-foreground whitespace-nowrap">Available Items:</span>
                  <span
                    className={`font-medium break-words ${remaining <= (product.reorderLevel || 10) ? 'text-destructive' : ''}`}
                  >
                    {remaining}
                    {inCart > 0 && (
                      <span className="ml-1 text-xs text-muted-foreground">({inCart} in cart)</span>
                    )}
                  </span>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-shrink-0 p-5 pt-3">
              <Button
                variant="default"
                size="sm"
                className="w-full text-xs sm:text-sm"
                onClick={() => handleAddSale(product)}
                disabled={!canEdit || remaining <= 0}
              >
                <ShoppingCart className="h-3 w-3 sm:h-4 sm:w-4 mr-2 flex-shrink-0" />
                Add to Sales
              </Button>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}
