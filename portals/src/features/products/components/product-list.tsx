import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getColumns, type Product } from '@/features/products/pages/columns'
import { DataTable } from '@/shared/components/data-table/data-table'

interface ProductListProps {
  data: Product[]
  onReload: () => void
}

export function ProductList({ data, onReload }: ProductListProps) {
  const navigate = useNavigate()
  // Built once per `onReload`: new column definitions on every render rebuilt
  // each row's actions cell — closing any open Edit sheet — whenever the list
  // re-rendered (a refetch re-signs image links every 15 minutes).
  const columns = useMemo(() => getColumns(onReload), [onReload])

  return (
    <DataTable
      columns={columns}
      data={data}
      meta={{ onRowClick: (row: Product) => navigate(`/inventory/products/${row.id}`) }}
    />
  )
}
