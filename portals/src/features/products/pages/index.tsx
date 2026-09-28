import { useQuery } from '@tanstack/react-query'
import { getProducts } from '@/lib/actions/products'
import { getProductsLockStatus } from '@/lib/actions/settings'
import { queryKeys } from '@/lib/query-keys'
import { ProductsClient } from './products-client'

export default function ProductsPage() {
  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: queryKeys.products.list(),
    queryFn: async () => {
      const result = await getProducts()
      return result.success ? (result.data ?? []) : []
    },
  })

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

  if (productsLoading || lockLoading) return null

  return (
    <ProductsClient
      products={products}
      isLocked={lockStatus.isLocked}
      isAdmin={lockStatus.isAdmin}
    />
  )
}
