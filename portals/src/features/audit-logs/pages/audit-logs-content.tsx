import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Activity,
  Calendar,
  Download,
  Eye,
  Filter,
  Layers,
  RotateCcw,
  Search,
  User as UserIcon,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { DataTablePagination } from '@/shared/components/data-table/data-table-pagination'
import { DataTableViewOptions } from '@/shared/components/data-table/data-table-view-options'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import {
  type AuditLog,
  AuditLogDetailSheet,
  formatModule,
  getActionStyle,
} from '../components/audit-log-detail-sheet'

const ALL_FILTER_VALUE = '__all__'

function getUserDisplay(user: AuditLog['user']): string {
  if (!user) return 'System'
  return user.name || user.email || 'Unknown User'
}

function escapeCsv(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function summarizeChanges(log: AuditLog): string {
  if (log.changedFields && log.changedFields.length > 0) {
    return log.changedFields.join('; ')
  }
  if (!log.changes || typeof log.changes !== 'object') return ''
  const keys = Object.keys(log.changes as Record<string, unknown>)
  if (keys.length === 0) return ''
  return keys.join('; ')
}

function buildCsv(rows: AuditLog[]): string {
  const header = [
    'timestamp',
    'user',
    'action',
    'module',
    'entity name',
    'entity id',
    'ip address',
    'changed fields',
  ]
  const lines = [header.map(escapeCsv).join(',')]
  for (const log of rows) {
    const timestamp = format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss')
    const fields = [
      timestamp,
      getUserDisplay(log.user),
      log.action,
      log.module,
      log.entityName ?? '',
      log.entityId ?? '',
      log.ipAddress ?? '',
      summarizeChanges(log),
    ]
    lines.push(fields.map((f) => escapeCsv(String(f))).join(','))
  }
  return lines.join('\n')
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function AuditLogsContent({
  logs,
  entityFilter,
  onClearEntityFilter,
  onFilterByEntity,
}: {
  logs: AuditLog[]
  /** §19.2 — when set, the list is server-side scoped to this entity id. */
  entityFilter?: string
  onClearEntityFilter?: () => void
  onFilterByEntity?: (entityId: string) => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string>(ALL_FILTER_VALUE)
  const [selectedAction, setSelectedAction] = useState<string>(ALL_FILTER_VALUE)
  const [selectedModule, setSelectedModule] = useState<string>(ALL_FILTER_VALUE)
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')

  // Detail Sheet state
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  // Table state
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  // Human-readable entity label
  const entityLabel = useMemo(() => {
    if (!entityFilter) return null
    const named = logs.find((l) => l.entityName)?.entityName
    return named ?? entityFilter
  }, [logs, entityFilter])

  // Unique user options
  const userOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const log of logs) {
      if (log.user?.id) {
        map.set(log.user.id, getUserDisplay(log.user))
      }
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [logs])

  // Unique action options
  const actionOptions = useMemo(() => {
    const set = new Set<string>()
    for (const log of logs) {
      if (log.action) set.add(log.action)
    }
    return Array.from(set).sort()
  }, [logs])

  // Unique module options
  const moduleOptions = useMemo(() => {
    const set = new Set<string>()
    for (const log of logs) {
      if (log.module) set.add(log.module)
    }
    return Array.from(set).sort()
  }, [logs])

  // Filtered dataset
  const filteredLogs = useMemo(() => {
    const searchLower = searchQuery.trim().toLowerCase()
    const fromTs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null
    const toTs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null

    return logs.filter((log) => {
      // User filter
      if (selectedUserId !== ALL_FILTER_VALUE) {
        if (log.user?.id !== selectedUserId) return false
      }

      // Action filter
      if (selectedAction !== ALL_FILTER_VALUE) {
        if (log.action.toLowerCase() !== selectedAction.toLowerCase()) return false
      }

      // Module filter
      if (selectedModule !== ALL_FILTER_VALUE) {
        if (log.module.toLowerCase() !== selectedModule.toLowerCase()) return false
      }

      // Date filters
      const ts = new Date(log.createdAt).getTime()
      if (fromTs !== null && ts < fromTs) return false
      if (toTs !== null && ts > toTs) return false

      // Global search text
      if (searchLower) {
        const userName = log.user?.name?.toLowerCase() || ''
        const userEmail = log.user?.email?.toLowerCase() || ''
        const action = log.action.toLowerCase()
        const moduleName = log.module.toLowerCase()
        const entityName = log.entityName?.toLowerCase() || ''
        const entityId = log.entityId?.toLowerCase() || ''
        const ip = log.ipAddress?.toLowerCase() || ''
        const reason = log.reason?.toLowerCase() || ''
        const changedFieldsStr = log.changedFields?.join(' ').toLowerCase() || ''

        const match =
          userName.includes(searchLower) ||
          userEmail.includes(searchLower) ||
          action.includes(searchLower) ||
          moduleName.includes(searchLower) ||
          entityName.includes(searchLower) ||
          entityId.includes(searchLower) ||
          ip.includes(searchLower) ||
          reason.includes(searchLower) ||
          changedFieldsStr.includes(searchLower)

        if (!match) return false
      }

      return true
    })
  }, [logs, selectedUserId, selectedAction, selectedModule, fromDate, toDate, searchQuery])

  const isFiltered =
    searchQuery !== '' ||
    selectedUserId !== ALL_FILTER_VALUE ||
    selectedAction !== ALL_FILTER_VALUE ||
    selectedModule !== ALL_FILTER_VALUE ||
    fromDate !== '' ||
    toDate !== ''

  const handleClearFilters = () => {
    setSearchQuery('')
    setSelectedUserId(ALL_FILTER_VALUE)
    setSelectedAction(ALL_FILTER_VALUE)
    setSelectedModule(ALL_FILTER_VALUE)
    setFromDate('')
    setToDate('')
  }

  const handleExport = () => {
    const csv = buildCsv(filteredLogs)
    const filename = `audit-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`
    downloadCsv(filename, csv)
  }

  // Column definitions
  const columns = useMemo<ColumnDef<AuditLog>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Timestamp" />,
        cell: ({ row }) => {
          const d = new Date(row.original.createdAt)
          return (
            <div className="flex flex-col py-0.5">
              <span className="font-mono text-xs font-medium text-foreground">
                {format(d, 'yyyy-MM-dd HH:mm:ss')}
              </span>
              <span className="text-[11px] text-muted-foreground" title={d.toISOString()}>
                {formatDistanceToNow(d, { addSuffix: true })}
              </span>
            </div>
          )
        },
        sortingFn: 'datetime',
      },
      {
        id: 'user',
        header: ({ column }) => <DataTableColumnHeader column={column} title="User" />,
        cell: ({ row }) => {
          const user = row.original.user
          const name = user?.name || (user?.email ? user.email.split('@')[0] : 'System')
          const email = user?.email
          return (
            <div className="flex items-center gap-2 max-w-[170px]">
              <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold shrink-0">
                {name.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col truncate">
                <span className="font-medium text-xs text-foreground truncate">{name}</span>
                {email && (
                  <span className="text-[11px] text-muted-foreground truncate">{email}</span>
                )}
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: 'action',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Action" />,
        cell: ({ row }) => {
          const action = row.original.action
          const style = getActionStyle(action)
          const Icon = style.icon
          return (
            <Badge
              variant="outline"
              className={`capitalize gap-1 text-xs py-0.5 px-2 font-medium ${style.bg} ${style.border}`}
            >
              <Icon className="h-3 w-3" />
              {action}
            </Badge>
          )
        },
      },
      {
        accessorKey: 'module',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Module" />,
        cell: ({ row }) => (
          <Badge variant="secondary" className="text-xs font-medium">
            {formatModule(row.original.module)}
          </Badge>
        ),
      },
      {
        id: 'entity',
        header: 'Target / Entity',
        cell: ({ row }) => {
          const { entityName, entityId } = row.original
          if (!entityName && !entityId) {
            return <span className="text-xs text-muted-foreground/60">—</span>
          }
          return (
            <div className="flex flex-col max-w-[190px]">
              {entityName && (
                <span className="text-xs font-medium text-foreground truncate" title={entityName}>
                  {entityName}
                </span>
              )}
              {entityId && (
                <span
                  className="text-[11px] font-mono text-muted-foreground truncate"
                  title={entityId}
                >
                  {entityId}
                </span>
              )}
            </div>
          )
        },
      },
      {
        id: 'changes',
        header: 'Changes',
        cell: ({ row }) => {
          const changedFields = row.original.changedFields
          const changes = row.original.changes

          if (changedFields && changedFields.length > 0) {
            const displayed = changedFields.slice(0, 2)
            const remaining = changedFields.length - 2
            return (
              <div className="flex items-center gap-1 flex-wrap">
                {displayed.map((f) => (
                  <Badge
                    key={f}
                    variant="outline"
                    className="font-mono text-[10px] py-0 px-1.5 bg-muted/40"
                  >
                    {f}
                  </Badge>
                ))}
                {remaining > 0 && (
                  <span className="text-[10px] text-muted-foreground font-medium">
                    +{remaining} more
                  </span>
                )}
              </div>
            )
          }

          if (changes && typeof changes === 'object' && Object.keys(changes).length > 0) {
            const keys = Object.keys(changes)
            const displayed = keys.slice(0, 2)
            const remaining = keys.length - 2
            return (
              <div className="flex items-center gap-1 flex-wrap">
                {displayed.map((k) => (
                  <Badge
                    key={k}
                    variant="outline"
                    className="font-mono text-[10px] py-0 px-1.5 bg-muted/40"
                  >
                    {k}
                  </Badge>
                ))}
                {remaining > 0 && (
                  <span className="text-[10px] text-muted-foreground font-medium">
                    +{remaining} more
                  </span>
                )}
              </div>
            )
          }

          return <span className="text-xs text-muted-foreground/60">—</span>
        },
      },
      {
        accessorKey: 'ipAddress',
        header: 'IP Address',
        cell: ({ row }) => {
          const ip = row.original.ipAddress
          if (!ip) return <span className="text-xs text-muted-foreground/60">—</span>
          return <span className="font-mono text-xs text-muted-foreground">{ip}</span>
        },
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                setSelectedLog(row.original)
                setIsSheetOpen(true)
              }}
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="sr-only">View Details</span>
            </Button>
          </div>
        ),
      },
    ],
    []
  )

  const table = useReactTable({
    data: filteredLogs,
    columns,
    state: {
      sorting,
      columnVisibility,
    },
    initialState: {
      pagination: {
        pageSize: 25,
      },
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Top Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Logs</h1>
          <p className="text-muted-foreground">
            Complete history of all system changes and user actions
          </p>
          {entityFilter && (
            <Badge
              variant="secondary"
              className="mt-2 inline-flex items-center gap-1.5 py-1 pl-2.5 pr-1"
            >
              <Filter className="h-3 w-3 text-primary" />
              <span>
                Filtered to entity{' '}
                <span className="font-semibold text-foreground">{entityLabel}</span>
              </span>
              {onClearEntityFilter && (
                <button
                  type="button"
                  onClick={onClearEntityFilter}
                  className="ml-0.5 rounded-sm p-0.5 hover:bg-background/80"
                  aria-label="Clear entity filter"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={filteredLogs.length === 0}
            className="h-9 gap-1.5"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <ComplianceExportButtons />
        </div>
      </div>

      {/* Filter Bar Card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
            {/* Search Input */}
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label
                htmlFor="audit-search"
                className="text-xs flex items-center gap-1 text-muted-foreground"
              >
                <Search className="h-3 w-3" />
                Search
              </Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="audit-search"
                  placeholder="Search user, action, module, entity..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-9 text-xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* User Select */}
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="audit-user-filter"
                className="text-xs flex items-center gap-1 text-muted-foreground"
              >
                <UserIcon className="h-3 w-3" />
                User
              </Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger id="audit-user-filter" className="h-9 text-xs">
                  <SelectValue placeholder="All users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE} className="text-xs">
                    All users
                  </SelectItem>
                  {userOptions.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-xs">
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Action Select */}
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="audit-action-filter"
                className="text-xs flex items-center gap-1 text-muted-foreground"
              >
                <Activity className="h-3 w-3" />
                Action
              </Label>
              <Select value={selectedAction} onValueChange={setSelectedAction}>
                <SelectTrigger id="audit-action-filter" className="h-9 text-xs">
                  <SelectValue placeholder="All actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE} className="text-xs">
                    All actions
                  </SelectItem>
                  {actionOptions.map((act) => (
                    <SelectItem key={act} value={act} className="text-xs capitalize">
                      {act}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Module Select */}
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="audit-module-filter"
                className="text-xs flex items-center gap-1 text-muted-foreground"
              >
                <Layers className="h-3 w-3" />
                Module
              </Label>
              <Select value={selectedModule} onValueChange={setSelectedModule}>
                <SelectTrigger id="audit-module-filter" className="h-9 text-xs">
                  <SelectValue placeholder="All modules" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE} className="text-xs">
                    All modules
                  </SelectItem>
                  {moduleOptions.map((mod) => (
                    <SelectItem key={mod} value={mod} className="text-xs">
                      {formatModule(mod)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Range: From */}
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="audit-from"
                className="text-xs text-muted-foreground flex items-center gap-1"
              >
                <Calendar className="h-3 w-3" />
                From Date
              </Label>
              <Input
                id="audit-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>

          {/* Bottom Filter Controls Bar */}
          <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{filteredLogs.length}</span>{' '}
                of <span className="font-semibold text-foreground">{logs.length}</span> total
                entries
              </span>
              {isFiltered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset filters
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <DataTableViewOptions table={table} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* DataTable Card */}
      <Card>
        <CardHeader className="py-4 px-6 border-b border-border/40">
          <CardTitle className="text-base flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <span>Activity History</span>
            </div>
            <span className="text-xs font-normal text-muted-foreground">
              Single-click any row to view full details & diffs
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="bg-muted/40 hover:bg-muted/40">
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className="text-xs font-semibold">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && 'selected'}
                      className="cursor-pointer hover:bg-muted/60 transition-colors group"
                      onClick={() => {
                        setSelectedLog(row.original)
                        setIsSheetOpen(true)
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="py-2.5">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-36 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Activity className="h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm font-medium">No audit logs found</p>
                        {isFiltered ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleClearFilters}
                            className="text-xs mt-1"
                          >
                            Clear all filters
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="p-4 border-t border-border">
            <DataTablePagination table={table} />
          </div>
        </CardContent>
      </Card>

      {/* Slide-in Detail Sheet */}
      <AuditLogDetailSheet
        log={selectedLog}
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        onFilterByEntity={onFilterByEntity}
      />
    </div>
  )
}

// ─── Compliance exports ────────────────────────────────────────────────────

import { downloadAuditReportUrl, downloadCredentialsComplianceUrl } from '@/lib/actions/hr-phase2-4'
import { API_BASE_URL } from '@/lib/api-client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

function ComplianceExportButtons() {
  const [open, setOpen] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [from, setFrom] = useState(thirtyDaysAgo)
  const [to, setTo] = useState(today)
  const [moduleFilter, setModuleFilter] = useState('')

  function buildAuditUrl(): string {
    const fromIso = new Date(`${from}T00:00:00`).toISOString()
    const toIso = new Date(`${to}T23:59:59`).toISOString()
    return `${API_BASE_URL}${downloadAuditReportUrl(fromIso, toIso, moduleFilter || undefined)}`
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="h-9 gap-1.5">
        <Download className="h-4 w-4" />
        Compliance exports
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Compliance exports</DialogTitle>
            <DialogDescription>
              Pick a date range and an optional module filter. Downloads stream as CSV; the
              audit-report query is capped at 50,000 rows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium">Audit log range</h4>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="compliance-audit-from">From</Label>
                  <Input
                    id="compliance-audit-from"
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="compliance-audit-to">To</Label>
                  <Input
                    id="compliance-audit-to"
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-2 space-y-1.5">
                <Label htmlFor="compliance-audit-module">Module filter (optional)</Label>
                <Input
                  id="compliance-audit-module"
                  value={moduleFilter}
                  onChange={(e) => setModuleFilter(e.target.value)}
                  placeholder="e.g. access_management,staff (comma-separated)"
                />
              </div>
              <Button asChild size="sm" className="mt-2 w-full">
                <a href={buildAuditUrl()} target="_blank" rel="noopener noreferrer">
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download audit CSV
                </a>
              </Button>
            </div>

            <div className="border-t border-border pt-3">
              <h4 className="text-sm font-medium">Credentials compliance</h4>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Every staff member × each credential, with verification status. Use for Ghana Dental
                Council audit requests.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-2 w-full">
                <a
                  href={`${API_BASE_URL}${downloadCredentialsComplianceUrl()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download credentials CSV
                </a>
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
