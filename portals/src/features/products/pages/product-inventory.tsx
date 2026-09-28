import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { AddProductSheet } from '@/features/products/components/add-product-sheet'
import { ProductList } from '@/features/products/components/product-list'
import { ProductsLockToggle } from '@/features/products/components/products-lock-toggle'
import { getProducts } from '@/lib/actions/products'
import { getProductsLockStatus } from '@/lib/actions/settings'
import { queryKeys } from '@/lib/query-keys'

export default function ProductInventoryPage() {
  const queryClient = useQueryClient()

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: queryKeys.products.list(),
    queryFn: async () => {
      const result = await getProducts()
      return result.success ? (result.data ?? []) : []
    },
  })

  // Same bare key `products/pages/index.tsx` reads for its own lock toggle —
  // both read the products sub-field of the shared `/api/settings/locks`
  // response, so sharing the key is intentional (unlike inventory's dedicated
  // key, which avoids colliding with this one over a *different* sub-field).
  const { data: lockStatus = { isLocked: false, isAdmin: false }, isLoading: lockLoading } =
    useQuery({
      queryKey: queryKeys.settings.locks(),
      queryFn: async () => {
        const result = await getProductsLockStatus()
        return result.success
          ? (result.data as { isLocked: boolean; isAdmin: boolean })
          : { isLocked: false, isAdmin: false }
      },
    })

  // Stable, so the product list keeps its row actions (and open sheets) mounted.
  const refreshProducts = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
    [queryClient]
  )

  if (productsLoading || lockLoading) return null

  const canEdit = !lockStatus.isLocked || lockStatus.isAdmin

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Product Inventory</h1>
          <p className="text-muted-foreground">Manage all retail products and stock levels.</p>
        </div>
        <div className="flex items-center gap-3">
          <ProductsLockToggle isLocked={lockStatus.isLocked} isAdmin={lockStatus.isAdmin} />
          <AddProductSheet
            disabled={!canEdit}
            isAdmin={lockStatus.isAdmin}
            onSuccess={refreshProducts}
          />
        </div>
      </div>

      <ProductList data={products} onReload={refreshProducts} />
    </div>
  )
}
