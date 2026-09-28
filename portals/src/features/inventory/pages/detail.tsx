import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { InventoryDetailContent } from '@/features/inventory/components/inventory-detail-content'
import { getInventoryItem } from '@/lib/actions/inventory'
import { useLoading } from '@/lib/loading-context'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'

export default function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { setIsLoading } = useLoading()

  const itemQuery = useApiQuery(
    queryKeys.inventory.detail(id ?? ''),
    () => getInventoryItem(id as string),
    { enabled: !!id }
  )
  const item = itemQuery.data ?? null

  useEffect(() => {
    setIsLoading(itemQuery.isFetching)
  }, [itemQuery.isFetching, setIsLoading])

  useEffect(() => {
    if (!id || (!itemQuery.isFetching && itemQuery.isError)) {
      navigate('/inventory')
    }
  }, [id, itemQuery.isFetching, itemQuery.isError, navigate])

  if (itemQuery.isFetching) return null
  if (!item) return null

  return <InventoryDetailContent product={item} onReload={() => itemQuery.refetch()} />
}
