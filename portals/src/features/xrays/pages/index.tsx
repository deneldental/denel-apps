import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ExternalLink, FileImage, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Pagination } from '@/features/financial-records/components/pagination'
import { api } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { AddXraySheet } from '../components/add-xray-sheet'
import type { XrayType } from '../types'

interface XrayRecord {
  id: string
  patientId: string
  xrayTypeId: string | null
  origin: string
  imageUrl: string
  capturedAt: string | null
  uploadedAt: string
  notes: string | null
  type?: { id: string; name: string; displayName: string } | null
  patient?: { id: string; name: string } | null
}

/** GET /api/xrays returns `{ data, total }` (top-level siblings, not in ApiResponse's typed fields). */
interface XrayListResponse {
  data?: XrayRecord[]
  total?: number
}

function patientName(r: XrayRecord) {
  return r.patient?.name || '—'
}

const PAGE_SIZE = 50

export default function XraysListPage() {
  const navigate = useNavigate()
  const [addOpen, setAddOpen] = useState(false)
  const [typeId, setTypeId] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)

  // Debounce the patient-name search so we don't hammer the server per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Reset to page 1 whenever any filter or the search changes (skip initial mount).
  const initialMountRef = useRef(true)
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false
      return
    }
    setPage(1)
  }, [])

  // Type dropdown is driven by the full active-types lookup, not the current page.
  const { data: types = [] } = useQuery({
    queryKey: [...queryKeys.xrays.all, 'types'],
    queryFn: async () => {
      const res = await api.get<XrayType[]>('/api/xrays/types')
      return res.success && res.data ? res.data.filter((t) => t.active) : []
    },
  })

  const {
    data: result,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    // Page params added inline (query-keys.ts is intentionally not modified).
    queryKey: [...queryKeys.xrays.list(), { page, typeId, from, to, q: debouncedSearch }],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String((page - 1) * PAGE_SIZE))
      if (typeId !== 'all') params.set('xrayTypeId', typeId)
      if (from) params.set('from', `${from}T00:00:00`)
      if (to) params.set('to', `${to}T23:59:59`)
      if (debouncedSearch) params.set('q', debouncedSearch)
      const res = (await api.get<XrayRecord[]>(
        `/api/xrays?${params.toString()}`
      )) as XrayListResponse & { success: boolean }
      return {
        rows: res.success && res.data ? res.data : [],
        total: res.total ?? res.data?.length ?? 0,
      }
    },
    placeholderData: keepPreviousData,
  })

  const records = result?.rows ?? []
  const total = result?.total ?? 0

  // "X-rays today" counts against the whole dataset, independent of the table's
  // filters/paging — a small dedicated count query keyed on today's date.
  const today = format(new Date(), 'yyyy-MM-dd')
  const { data: todayCount = 0 } = useQuery({
    queryKey: [...queryKeys.xrays.all, 'today-count', today],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: '1',
        offset: '0',
        from: `${today}T00:00:00`,
        to: `${today}T23:59:59`,
      })
      const res = (await api.get<XrayRecord[]>(
        `/api/xrays?${params.toString()}`
      )) as XrayListResponse & { success: boolean }
      return res.total ?? 0
    },
  })

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileImage className="h-6 w-6" />
            X-rays
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Capture, review, and securely share dental X-rays.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add new X-ray
          </Button>
        </div>
      </div>

      {/* Summary */}
      <Card className="bg-muted/60 border-none">
        <CardContent className="py-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            X-rays today
          </p>
          <p className="text-5xl font-bold tracking-tight mt-1">{todayCount}</p>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="xr-search">
            Patient
          </label>
          <Input
            id="xr-search"
            placeholder="Search by patient name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[220px]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="xr-filter-from">
            From
          </label>
          <Input
            id="xr-filter-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-[150px]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="xr-filter-to">
            To
          </label>
          <Input
            id="xr-filter-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-[150px]"
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Type</p>
          <Select value={typeId} onValueChange={setTypeId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(from || to || typeId !== 'all' || search) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom('')
              setTo('')
              setTypeId('all')
              setSearch('')
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No X-rays match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => {
                const takenDate = r.capturedAt || r.uploadedAt
                return (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/xrays/${r.id}`)}
                  >
                    <TableCell className="whitespace-nowrap">
                      {format(new Date(takenDate), 'MMM d, yyyy')}
                      <span className="block text-xs text-muted-foreground">
                        {format(new Date(takenDate), 'h:mm a')}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{patientName(r)}</TableCell>
                    <TableCell>{r.type?.displayName || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize text-[10px]">
                        {r.origin}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/xrays/${r.id}`}>View</Link>
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/xrays/${r.id}`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                            <span className="sr-only">Open in new tab</span>
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        currentPage={page}
        totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        onPageChange={setPage}
        totalItems={total}
        pageSize={PAGE_SIZE}
        itemLabel="X-rays"
      />

      <AddXraySheet open={addOpen} onOpenChange={setAddOpen} onSaved={() => refetch()} />
    </div>
  )
}
