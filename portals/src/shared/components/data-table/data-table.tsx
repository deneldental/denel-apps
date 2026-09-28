import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table'
import * as React from 'react'
import { DataTablePagination } from '@/shared/components/data-table/data-table-pagination'
import { DataTableToolbar } from '@/shared/components/data-table/data-table-toolbar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

interface TableMeta<TData> {
  onRowClick?: (data: TData) => void
  [key: string]: unknown
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  onExport?: () => void
  onImport?: () => void
  onDownloadTemplate?: () => void
  initialColumnVisibility?: VisibilityState
  meta?: TableMeta<TData>
}

/**
 * Generic TanStack DataTable wrapper with built-in sorting, filtering, pagination,
 * column visibility, and row-selection state.
 *
 * ⚠️ Performance: callers should memoize `columns` and `data` with `useMemo` to
 * avoid retriggering row-model recomputation on every parent render. The row-model
 * builders below are created once via `useMemo` so the table instance itself stays
 * reference-stable across re-renders where inputs don't change.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  onExport,
  onImport,
  onDownloadTemplate,
  initialColumnVisibility = {},
  meta,
}: DataTableProps<TData, TValue>) {
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(initialColumnVisibility)
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = React.useState<string>('')
  // The page is kept here, not reset whenever `data` changes: a background
  // refetch re-signs private file links every 15 minutes, handing the table new
  // row objects with nothing changed — the user must stay on their page. Sorting
  // or filtering still starts again from the first page.
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const toFirstPage = React.useCallback(
    () => setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 })),
    []
  )
  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting(updater)
    toFirstPage()
  }
  const onColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
    setColumnFilters(updater)
    toFirstPage()
  }
  const onGlobalFilterChange: OnChangeFn<string> = (updater) => {
    setGlobalFilter(updater)
    toFirstPage()
  }

  const idsAreUnique = React.useMemo(() => {
    const ids = new Set<string>()
    for (const row of data) {
      const id = (row as { id?: unknown }).id
      if (typeof id !== 'string' && typeof id !== 'number') return false
      ids.add(String(id))
    }
    return ids.size === data.length
  }, [data])

  const table = useReactTable({
    data,
    columns,
    meta,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      globalFilter,
      pagination,
    },
    // Rows are identified by their record's id, so a row's own state — an open
    // actions menu or edit sheet — stays with its record when a refetch
    // reorders the list. Lists without a unique id on every row keep using
    // positions, as before.
    getRowId: (row, index) => (idsAreUnique ? String((row as { id: unknown }).id) : String(index)),
    autoResetPageIndex: false,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange,
    onColumnFiltersChange,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  // When the list shrinks below the current page, show its last page instead
  // of an empty one.
  const pageCount = table.getPageCount()
  React.useEffect(() => {
    setPagination((p) => {
      const last = Math.max(0, pageCount - 1)
      return p.pageIndex > last ? { ...p, pageIndex: last } : p
    })
  }, [pageCount])

  return (
    <div className="space-y-4">
      <DataTableToolbar
        table={table}
        onExport={onExport}
        onImport={onImport}
        onDownloadTemplate={onDownloadTemplate}
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className={
                    meta?.onRowClick || (row.original as { onRowClick?: () => void }).onRowClick
                      ? 'cursor-pointer hover:bg-muted/50'
                      : ''
                  }
                  onClick={() => {
                    const original = row.original as { onRowClick?: () => void }
                    if (original.onRowClick) {
                      original.onRowClick()
                    } else if (meta?.onRowClick) {
                      meta.onRowClick(row.original)
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      onClick={(e) => {
                        // Prevent row click when clicking on actions dropdown
                        if (cell.column.id === 'actions') {
                          e.stopPropagation()
                        }
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} />
    </div>
  )
}
