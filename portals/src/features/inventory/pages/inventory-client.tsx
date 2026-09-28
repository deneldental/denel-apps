import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataTable } from '@/shared/components/data-table/data-table'
import { getColumns, type Product } from './columns'

interface InventoryClientProps {
  products: Product[]
  canEdit?: boolean
  onReload: () => void
}

export function InventoryClient({ products, canEdit = true, onReload }: InventoryClientProps) {
  const navigate = useNavigate()

  const handleRowClick = useCallback(
    (product: Product) => navigate(`/inventory/${product.id}`),
    [navigate]
  )

  // Built once per input: new column definitions (or new row objects) on every
  // render rebuilt each row's actions cell — closing any open Edit or
  // Adjust-stock sheet — whenever the list re-rendered (a refetch re-signs image
  // links every 15 minutes). Row clicks go through `meta.onRowClick`.
  const columns = useMemo(
    () => getColumns((id) => navigate(`/inventory/${id}`), canEdit, onReload),
    [navigate, canEdit, onReload]
  )

  return (
    <DataTable
      columns={columns}
      data={products}
      initialColumnVisibility={{ sku: false }}
      meta={{ onRowClick: handleRowClick, canEdit }}
    />
  )
}
