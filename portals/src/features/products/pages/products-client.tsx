import { ProductsGallery } from '@/features/products/components/products-gallery'
import { TodaySalesPanel } from '@/features/products/components/today-sales-panel'
import type { Product } from './columns'

interface ProductsClientProps {
  products: Product[]
  isLocked: boolean
  isAdmin: boolean
}

export function ProductsClient({ products, isLocked, isAdmin }: ProductsClientProps) {
  const canEdit = !isLocked || isAdmin

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Products</h1>
        <p className="text-sm text-muted-foreground">
          Browse retail products and add them to today’s sales draft.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="min-h-0 overflow-auto pr-1">
          <ProductsGallery products={products} canEdit={canEdit} />
        </div>
        <div className="min-h-0 lg:sticky lg:top-0">
          <TodaySalesPanel disabled={!canEdit} />
        </div>
      </div>
    </div>
  )
}
