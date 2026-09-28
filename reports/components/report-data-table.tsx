import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'

// Allow per-column cell/header styling (e.g. right-aligned amount columns).
declare module '@tanstack/react-table' {
  // biome-ignore lint/correctness/noUnusedVariables: required signature for module augmentation
  interface ColumnMeta<TData, TValue> {
    className?: string
  }
}

import { ReportEmptyState } from '@/components/report-page'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type ReportDataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  /** Rows per page. Detail tables can be long — paginate so we don't render
   *  thousands of `<TableRow>` at once (L34). */
  pageSize?: number
  emptyMessage?: string
}

/**
 * Paginated detail table built on the already-present `@tanstack/react-table`.
 * Used for the long report detail tables (discounts, specialist commissions,
 * AP aging, deferred revenue) so wide date ranges don't render unbounded rows.
 */
export function ReportDataTable<TData>({
  columns,
  data,
  pageSize = 25,
  emptyMessage = 'No rows.',
}: ReportDataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  })

  if (data.length === 0) {
    return <ReportEmptyState message={emptyMessage} />
  }

  const { pageIndex } = table.getState().pagination
  const pageCount = table.getPageCount()

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className={header.column.columnDef.meta?.className}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {pageIndex + 1} of {pageCount} · {data.length} rows
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
