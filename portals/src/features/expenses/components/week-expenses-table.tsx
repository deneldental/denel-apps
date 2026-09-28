import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/components/data-table/data-table'

interface WeekExpensesTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
}

export function WeekExpensesTable<TData, TValue>({
  columns,
  data,
}: WeekExpensesTableProps<TData, TValue>) {
  const handleExport = () => {
    // TODO: implement CSV export
  }

  const handleImport = () => {
    // TODO: implement file import
  }

  return <DataTable columns={columns} data={data} onExport={handleExport} onImport={handleImport} />
}
