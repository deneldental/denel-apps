import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ComplianceDialog } from '@/features/compliance/components/compliance-dialog'
import {
  COMPLIANCE_CATEGORIES,
  type ComplianceDocument,
  deleteComplianceDocument,
  getComplianceDocuments,
} from '@/lib/actions/compliance'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { DataTablePagination } from '@/shared/components/data-table/data-table-pagination'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import { Input } from '@/shared/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { useComplianceCategories } from '@/shared/hooks/use-compliance-categories'

export type ComplianceStatus = 'current' | 'expiring_soon' | 'expired'

const STATUS_CONFIG: Record<
  ComplianceStatus,
  {
    label: string
    icon: typeof CheckCircle2
    badgeVariant: 'default' | 'secondary' | 'destructive'
  }
> = {
  current: { label: 'Current', icon: CheckCircle2, badgeVariant: 'default' },
  expiring_soon: { label: 'Expiring Soon', icon: Clock, badgeVariant: 'secondary' },
  expired: { label: 'Expired', icon: AlertTriangle, badgeVariant: 'destructive' },
}

function getDaysUntilExpiry(expiryDate: string): number {
  return Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export function deriveStatus(
  expiryDate: string | null | undefined,
  thresholdDays = 90
): ComplianceStatus {
  if (!expiryDate) return 'current'
  const days = getDaysUntilExpiry(expiryDate)
  if (days <= 0) return 'expired'
  if (days <= thresholdDays) return 'expiring_soon'
  return 'current'
}

export function StatusBadge({ status }: { status: ComplianceStatus }) {
  const { label, icon: Icon, badgeVariant } = STATUS_CONFIG[status]
  return (
    <Badge variant={badgeVariant} className="gap-1">
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  )
}

function KpiTile({
  title,
  value,
  description,
  icon: Icon,
  valueClass = '',
}: {
  title: string
  value: string | number
  description: string
  icon: any
  valueClass?: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

export default function AllCompliancePage() {
  const navigate = useNavigate()
  const [docs, setDocs] = useState<ComplianceDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ComplianceDocument | null>(null)

  // Shared with Settings → Compliance Categories: a save there invalidates
  // this key, so a newly-added category shows up here without a reload.
  const { categories: categoryRows } = useComplianceCategories()
  const liveCategories = categoryRows.filter((c) => c.isActive).map((c) => c.name)
  const categories =
    liveCategories.length > 0 ? liveCategories : COMPLIANCE_CATEGORIES.map((c) => c.label)

  // DataTable state
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const load = useCallback(async () => {
    setLoading(true)
    const docsRes = await getComplianceDocuments()
    if (docsRes.success && docsRes.data) setDocs(docsRes.data)
    else toast.error(docsRes.error ?? 'Failed to load compliance documents')
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleDelete() {
    if (!deleteTarget) return
    const res = await deleteComplianceDocument(deleteTarget.id)
    if (res.success) {
      setDocs((prev) => prev.filter((d) => d.id !== deleteTarget.id))
      toast.success('Document deleted')
    } else {
      toast.error(res.error ?? 'Failed to delete document')
    }
    setDeleteTarget(null)
  }

  const columns: ColumnDef<ComplianceDocument>[] = [
    {
      accessorKey: 'documentName',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Document" />,
      cell: ({ row }) => <div className="font-medium">{row.getValue('documentName')}</div>,
    },
    {
      accessorKey: 'category',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs capitalize">
          {row.getValue('category')}
        </Badge>
      ),
    },
    {
      accessorKey: 'issuingAuthority',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Authority" />,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.getValue('issuingAuthority') || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'dateExpired',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Expires" />,
      cell: ({ row }) => {
        const val = row.getValue('dateExpired') as string | null
        if (!val) return <span className="text-muted-foreground">No expiry</span>

        const daysLeft = getDaysUntilExpiry(val)
        return (
          <div className="text-sm">
            <span
              className={
                daysLeft <= 0
                  ? 'text-destructive'
                  : daysLeft <= 90
                    ? 'text-amber-600'
                    : 'text-muted-foreground'
              }
            >
              {new Date(val).toLocaleDateString()}
            </span>
            {daysLeft > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">({daysLeft}d)</span>
            )}
            {daysLeft <= 0 && (
              <span className="ml-1 text-xs text-destructive inline-flex items-center gap-0.5">
                <RefreshCw className="h-3 w-3" /> renew
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = deriveStatus(row.original.dateExpired)
        return <StatusBadge status={status} />
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const doc = row.original
        return (
          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => navigate(`/compliance/${doc.id}`)}
            >
              <span className="sr-only">View Details</span>
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              onClick={() => setDeleteTarget(doc)}
            >
              <span className="sr-only">Delete</span>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      },
    },
  ]

  const table = useReactTable({
    data: docs,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      columnFilters,
    },
    initialState: {
      pagination: {
        pageSize: 15,
      },
    },
  })

  const withStatus = docs.map((d) => deriveStatus(d.dateExpired))
  const expiredCount = withStatus.filter((s) => s === 'expired').length
  const expiringSoonCount = withStatus.filter((s) => s === 'expiring_soon').length
  const currentCount = withStatus.filter((s) => s === 'current').length

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Compliance</h1>
          <p className="text-muted-foreground">
            Track clinic compliance documents and renewal deadlines.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Document
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          title="Total Documents"
          value={docs.length}
          description="all tracked records"
          icon={FileText}
        />
        <KpiTile
          title="Up to Date"
          value={currentCount}
          description="currently active"
          icon={CheckCircle2}
        />
        <KpiTile
          title="Expiring Soon"
          value={expiringSoonCount}
          description="renew within 90 days"
          icon={Clock}
        />
        <KpiTile
          title="Expired"
          value={expiredCount}
          description="require immediate action"
          icon={AlertTriangle}
          valueClass={expiredCount > 0 ? 'text-destructive' : ''}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Compliance Records
          </CardTitle>
          <CardDescription>View and manage compliance documentation.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between py-4">
            <div className="relative max-w-sm w-full">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search documents..."
                value={(table.getColumn('documentName')?.getFilterValue() as string) ?? ''}
                onChange={(event) =>
                  table.getColumn('documentName')?.setFilterValue(event.target.value)
                }
                className="pl-9 w-full"
              />
            </div>
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      return (
                        <TableHead key={header.id}>
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
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center text-muted-foreground"
                    >
                      <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading...
                    </TableCell>
                  </TableRow>
                ) : table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && 'selected'}
                      className="cursor-pointer"
                      onClick={() => navigate(`/compliance/${row.original.id}`)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No results found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4">
            <DataTablePagination table={table} />
          </div>
        </CardContent>
      </Card>

      <ComplianceDialog
        open={dialogOpen}
        categories={categories}
        onOpenChange={(open) => {
          setDialogOpen(open)
        }}
        onSaved={() => void load()}
      />
      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Compliance Document"
        description="This permanently removes the document record and its reminder configuration."
        itemName={deleteTarget?.documentName}
      />
    </div>
  )
}
