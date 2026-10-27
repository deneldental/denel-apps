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
  type VisibilityState,
} from '@tanstack/react-table'
import { Archive, ArchiveRestore, Eye, MoreHorizontal, Pencil, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArchiveConfirmationDialog } from '@/features/patients/components/archive-confirmation-dialog'
import { EditPatientSheet } from '@/features/patients/components/edit-patient-sheet'
import { TagPills, tagVariantClass } from '@/features/patients/components/tag-pills'
import type { PatientTag } from '@/lib/actions/patient-tags'
import type { PatientTagCount } from '@/lib/actions/patients'
import { archivePatient, permanentlyDeletePatient, unarchivePatient } from '@/lib/actions/patients'
import { useCan } from '@/lib/permissions-context'
import { cn } from '@/lib/utils'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { DataTablePagination } from '@/shared/components/data-table/data-table-pagination'
import { AdminPasswordDialog } from '@/shared/components/ui/admin-password-dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { usePatientTagCatalog } from '@/shared/hooks/use-patient-tag-catalog'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PatientRow = {
  id: string
  patientId: string | null
  name: string
  phone: string | null
  gender: string
  dob: Date | string | null
  isChild: boolean
  // §2.7 — tags replace the legacy `type`/`isOrtho` fields.
  tags?: Array<Pick<PatientTag, 'id' | 'name' | 'color'>>
  nationality: string | null
  profileImage: string | null
  guardianName: string | null
  guardianPhone: string | null
  guardianEmail: string | null
  guardianAddress: string | null
  guardianOccupation: string | null
  email: string | null
  address: string | null
  occupation: string | null
  createdAt: Date | string
  [key: string]: unknown
}

// ─── Actions cell ─────────────────────────────────────────────────────────────

function PatientActions({
  patient,
  onReload,
  view,
  isAdmin,
}: {
  patient: PatientRow
  onReload?: () => void
  view: 'active' | 'archived'
  isAdmin: boolean
}) {
  const navigate = useNavigate()
  // Archiving/restoring a patient record is withheld from the front desk (see
  // bundle_clinical_full). Gate on the permission rather than the role id so
  // the menu always matches what the API will actually allow.
  const canDelete = useCan('patients', 'delete')
  // H5 — Edit had no permission check at all (only Delete/Archive did),
  // unlike the equivalent button on the Patient Detail page, which correctly
  // checks patients:update.
  const canUpdate = useCan('patients', 'update')
  const [showArchive, setShowArchive] = useState(false)
  const [showPermanentDelete, setShowPermanentDelete] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  // D9 — a 25-row page used to mount 25 full <EditPatientSheet>es (and fire 25
  // insurance-company fetches) just to draw the table. Latch on first open so
  // the sheet is only built for rows the user actually edits; the latch (rather
  // than gating straight on `showEdit`) keeps the close animation intact and
  // lets the dirty-guard hold the sheet open when it needs to.
  const [editMounted, setEditMounted] = useState(false)

  const handleArchive = async () => {
    const result = await archivePatient(patient.id)
    if (result.success) {
      toast.success('Patient archived')
      if (onReload) onReload()
    } else {
      toast.error(result.error || 'Failed to archive patient')
      throw new Error(result.error || 'Failed to archive patient')
    }
  }

  const handleRestore = async () => {
    const result = await unarchivePatient(patient.id)
    if (result.success) {
      toast.success('Patient restored')
      if (onReload) onReload()
    } else {
      toast.error(result.error || 'Failed to restore patient')
    }
  }

  const handlePermanentDelete = async (password: string) => {
    const result = await permanentlyDeletePatient(patient.id, password)
    if (!result.success) throw new Error(result.error || 'Failed to delete patient')
    toast.success('Patient permanently deleted')
    if (onReload) onReload()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Open menu</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/patients/${patient.id}`)
            }}
          >
            <Eye className="mr-2 h-4 w-4" />
            View
          </DropdownMenuItem>
          {view === 'active' && canUpdate && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                setEditMounted(true)
                setShowEdit(true)
              }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
          )}
          {canDelete && view === 'active' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  setShowArchive(true)
                }}
                className="text-destructive"
              >
                <Archive className="mr-2 h-4 w-4" />
                Archive
              </DropdownMenuItem>
            </>
          )}
          {canDelete && view === 'archived' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  handleRestore()
                }}
              >
                <ArchiveRestore className="mr-2 h-4 w-4" />
                Restore
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowPermanentDelete(true)
                  }}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Permanently delete
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {editMounted && (
        <EditPatientSheet
          patient={patient as any}
          open={showEdit}
          onOpenChange={setShowEdit}
          onCreated={onReload}
        />
      )}
      <ArchiveConfirmationDialog
        open={showArchive}
        onOpenChange={setShowArchive}
        onConfirm={handleArchive}
        title="Archive Patient"
        description="The patient moves to the Archived tab and stops appearing in the active list, pickers and reports. All history is kept."
        itemName={patient.name}
      />
      <AdminPasswordDialog
        open={showPermanentDelete}
        onOpenChange={setShowPermanentDelete}
        onConfirm={handlePermanentDelete}
        title="Permanently Delete Patient"
        description="This wipes the patient record and every appointment, invoice, payment and medical record tied to it. This cannot be undone."
        itemName={patient.name}
      />
    </>
  )
}

// ─── Column definitions ───────────────────────────────────────────────────────

function buildColumns(
  onReload: (() => void) | undefined,
  view: 'active' | 'archived',
  isAdmin: boolean
): ColumnDef<PatientRow>[] {
  const cols: ColumnDef<PatientRow>[] = [
    {
      accessorKey: 'patientId',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Patient ID" />,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.getValue('patientId') || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) => {
        const patient = row.original
        return (
          <div>
            <p className="font-medium">{patient.name}</p>
            {patient.isChild && patient.guardianName && (
              <p className="text-xs text-muted-foreground">Guardian: {patient.guardianName}</p>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'phone',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Phone" />,
      cell: ({ row }) => {
        const patient = row.original
        const phone = patient.isChild ? patient.guardianPhone : patient.phone
        return <span className="text-sm">{phone || '—'}</span>
      },
    },
    {
      accessorKey: 'gender',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Gender" />,
      cell: ({ row }) => (
        <span className="capitalize text-sm">{row.getValue('gender') || '—'}</span>
      ),
    },
    {
      accessorKey: 'dob',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Date of Birth" />,
      cell: ({ row }) => {
        const dob = row.getValue('dob') as Date | string | null
        if (!dob) return <span className="text-sm text-muted-foreground">—</span>
        const d = new Date(dob)
        const age = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25))
        return (
          <div>
            <p className="text-sm">{d.toLocaleDateString()}</p>
            <p className="text-xs text-muted-foreground">{age} yrs</p>
          </div>
        )
      },
    },
    {
      accessorKey: 'isChild',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
      cell: ({ row }) => {
        const isChild = row.getValue('isChild') as boolean
        return (
          <Badge variant={isChild ? 'secondary' : 'outline'} className="text-xs">
            {isChild ? 'Child' : 'Adult'}
          </Badge>
        )
      },
    },
  ]

  // §2.7 — Tags column (coloured pills) replaces the legacy Type/Ortho column.
  cols.push({
    id: 'tags',
    header: 'Tags',
    cell: ({ row }) => <TagPills tags={row.original.tags} />,
  })

  cols.push({
    id: 'actions',
    cell: ({ row }) => (
      <PatientActions patient={row.original} onReload={onReload} view={view} isAdmin={isAdmin} />
    ),
  })

  return cols
}

// ─── Main component ───────────────────────────────────────────────────────────

interface PatientTableProps {
  data: PatientRow[]
  onReload?: () => void
  loading?: boolean
  hideSearch?: boolean
  /** Server-driven mode: parent owns pagination + search state. */
  manualPagination?: boolean
  pageIndex?: number
  pageSize?: number
  pageCount?: number
  total?: number
  onPageChange?: (page: number) => void
  onPageSizeChange?: (size: number) => void
  globalFilter?: string
  onGlobalFilterChange?: (value: string) => void
  // §2.7 — tag filter (replaces the patient-type tabs). When the callback is
  // provided the table renders a multi-select chip bar driving `?tagIds[]=`.
  tagIds?: string[]
  onTagIdsChange?: (ids: string[]) => void
  tagCounts?: PatientTagCount[]
  // C5 — 'active' shows Edit/Archive; 'archived' shows Restore/Permanently
  // delete. Defaults to 'active' so every other caller of this table is
  // unaffected.
  view?: 'active' | 'archived'
  isAdmin?: boolean
}

export function PatientTable({
  data,
  onReload,
  loading = false,
  hideSearch = false,
  manualPagination = false,
  pageIndex,
  pageSize,
  pageCount,
  total,
  onPageChange,
  onPageSizeChange,
  globalFilter: globalFilterProp,
  onGlobalFilterChange,
  tagIds,
  onTagIdsChange,
  tagCounts,
  view = 'active',
  isAdmin = false,
}: PatientTableProps) {
  const navigate = useNavigate()
  const [internalFilter, setInternalFilter] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  // §2.7 — tag catalog for the filter chips (only loaded when filtering is wired).
  const tagFilterEnabled = onTagIdsChange !== undefined
  const { catalog: tagCatalog } = usePatientTagCatalog({
    activeOnly: true,
    enabled: tagFilterEnabled,
  })

  const selectedTagIds = tagIds ?? []
  const countForTag = (id: string) => tagCounts?.find((c) => c.tagId === id)?.count ?? 0
  const toggleTag = (id: string) => {
    onTagIdsChange?.(
      selectedTagIds.includes(id) ? selectedTagIds.filter((t) => t !== id) : [...selectedTagIds, id]
    )
  }

  const columns = buildColumns(onReload, view, isAdmin)
  const isControlledFilter = onGlobalFilterChange !== undefined
  const filterValue = isControlledFilter ? (globalFilterProp ?? '') : internalFilter

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter: filterValue,
      ...(manualPagination && pageIndex !== undefined && pageSize !== undefined
        ? { pagination: { pageIndex, pageSize } }
        : {}),
    },
    pageCount: manualPagination ? pageCount : undefined,
    manualPagination,
    manualFiltering: manualPagination,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: isControlledFilter ? onGlobalFilterChange : setInternalFilter,
    onPaginationChange: manualPagination
      ? (updater) => {
          if (typeof updater !== 'function') return
          const next = updater({ pageIndex: pageIndex ?? 0, pageSize: pageSize ?? 25 })
          if (next.pageIndex !== pageIndex) onPageChange?.(next.pageIndex)
          if (next.pageSize !== pageSize) onPageSizeChange?.(next.pageSize)
        }
      : undefined,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: manualPagination ? undefined : getFilteredRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: manualPagination
      ? undefined
      : (row, _columnId, value: string) => {
          const search = value.toLowerCase()
          const p = row.original
          return (
            p.name.toLowerCase().includes(search) ||
            (p.patientId?.toLowerCase().includes(search) ?? false) ||
            (p.phone?.toLowerCase().includes(search) ?? false) ||
            (p.guardianName?.toLowerCase().includes(search) ?? false) ||
            (p.guardianPhone?.toLowerCase().includes(search) ?? false)
          )
        },
  })

  const emptyMessage = loading
    ? 'Loading patients…'
    : view === 'archived'
      ? 'No archived patients.'
      : 'No patients found.'

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, ID, phone…"
            value={filterValue}
            onChange={(e) =>
              isControlledFilter
                ? onGlobalFilterChange?.(e.target.value)
                : setInternalFilter(e.target.value)
            }
            className="pl-9"
          />
        </div>
        {manualPagination && total !== undefined && (
          <span className="text-sm text-muted-foreground shrink-0">
            {total.toLocaleString()} total
          </span>
        )}
      </div>

      {/* §2.7 — tag filter chips (multi-select) replace the patient-type tabs. */}
      {tagFilterEnabled && tagCatalog.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tagCatalog.map((tag) => {
            const active = selectedTagIds.includes(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  tagVariantClass(tag.color, active),
                  !active && 'opacity-60 hover:opacity-100'
                )}
              >
                {tag.name}
                <span className="tabular-nums opacity-70">{countForTag(tag.id)}</span>
              </button>
            )
          })}
          {selectedTagIds.length > 0 && (
            <button
              type="button"
              onClick={() => onTagIdsChange?.([])}
              className="ml-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/patients/${row.original.id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      onClick={(e) => {
                        if (cell.column.id === 'actions') e.stopPropagation()
                      }}
                    >
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
                  {emptyMessage}
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
