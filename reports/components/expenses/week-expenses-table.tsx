import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data-table/data-table'

interface WeekExpensesTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
}

export function WeekExpensesTable<TData, TValue>({
  columns,
  data,
}: WeekExpensesTableProps<TData, TValue>) {
  const handleExport = () => {
    // Here you would implement actual export logic (e.g. to CSV)
    console.log('Exporting data...')
    alert('Export functionality triggered! This would download a CSV file.')
  }

  const handleImport = () => {
    // Here you would implement actual import logic (e.g. open file picker)
    console.log('Importing data...')
    alert('Import functionality triggered! This would open a file picker.')
  }

  return <DataTable columns={columns} data={data} onExport={handleExport} onImport={handleImport} />
}
