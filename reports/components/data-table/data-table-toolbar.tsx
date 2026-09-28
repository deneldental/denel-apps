import type { Table } from '@tanstack/react-table'
import { Download, FileDown, Upload, X } from 'lucide-react'
import { DataTableViewOptions } from '@/components/data-table/data-table-view-options'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface DataTableToolbarProps<TData> {
  table: Table<TData>
  onExport?: () => void
  onImport?: () => void
  onDownloadTemplate?: () => void
}

export function DataTableToolbar<TData>({
  table,
  onExport,
  onImport,
  onDownloadTemplate,
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center space-x-2">
        <Input
          placeholder="Filter..."
          value={(table.getState().globalFilter as string) ?? ''}
          onChange={(event) => table.setGlobalFilter(event.target.value)}
          className="h-8 w-[150px] lg:w-[250px]"
        />
        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => table.resetColumnFilters()}
            className="h-8 px-2 lg:px-3"
          >
            Reset
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="flex items-center space-x-2">
        {onDownloadTemplate && (
          <Button variant="outline" size="sm" className="h-8 lg:flex" onClick={onDownloadTemplate}>
            <FileDown className="mr-2 h-4 w-4" />
            Download Template
          </Button>
        )}
        {onImport && (
          <Button variant="outline" size="sm" className="h-8 lg:flex" onClick={onImport}>
            <Upload className="mr-2 h-4 w-4" />
            Import CSV
          </Button>
        )}
        {onExport && (
          <Button variant="outline" size="sm" className="h-8 lg:flex" onClick={onExport}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        )}
        <DataTableViewOptions table={table} />
      </div>
    </div>
  )
}
