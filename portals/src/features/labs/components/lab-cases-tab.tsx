import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Pagination } from '@/features/financial-records/components/pagination'
import { api } from '@/lib/api-client'
import { useCan } from '@/lib/permissions-context'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
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
import { formatAmount } from '@/shared/utils/currency'
import type { LabCase, LabVendor } from '../types'
import { STATUS_LABELS, STATUS_VARIANT } from '../types'
import { LabCaseFormDialog } from './lab-case-form-dialog'

interface Props {
  vendors: LabVendor[]
}

const PAGE_SIZE = 50

export function LabCasesTab({ vendors }: Props) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterVendor, setFilterVendor] = useState<string>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const canCreate = useCan('labs', 'create')
  const navigate = useNavigate()

  const filters = { status: filterStatus, vendorId: filterVendor, page }
  const casesQuery = useApiQuery(queryKeys.labs.cases(filters), async () => {
    const params = new URLSearchParams()
    if (filterStatus !== 'all') params.set('status', filterStatus)
    if (filterVendor !== 'all') params.set('vendorId', filterVendor)
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String((page - 1) * PAGE_SIZE))
    const res = await api.get<LabCase[]>(`/api/labs/cases?${params.toString()}`)
    // `total` is a top-level sibling of `data` (not part of ApiResponse's typed fields).
    const total = (res as { total?: number }).total ?? res.data?.length ?? 0
    return { success: res.success, data: { cases: res.data ?? [], total }, error: res.error }
  })
  const cases = casesQuery.data?.cases ?? []
  const total = casesQuery.data?.total ?? 0
  const loading = casesQuery.isLoading

  // Reset to page 1 whenever a filter changes (skip the initial mount).
  const initialMountRef = useRef(true)
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false
      return
    }
    setPage(1)
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold">Lab Cases</h3>
          <p className="text-xs text-muted-foreground">
            Track all lab work from draft to insertion.
          </p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Case
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterVendor} onValueChange={setFilterVendor}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vendors</SelectItem>
            {vendors.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : cases.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">No lab cases yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case #</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c) => {
                const dueDate = (() => {
                  try {
                    return c.expectedReturn ? new Date(c.expectedReturn) : null
                  } catch {
                    return null
                  }
                })()
                const overdue =
                  dueDate && dueDate < new Date() && ['sent', 'in_progress'].includes(c.status)
                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/labs/cases/${c.id}`)}
                  >
                    <TableCell className="font-mono text-xs">{c.caseNumber}</TableCell>
                    <TableCell>
                      {c.patient ? (
                        <Link
                          to={`/patients/${c.patientId}`}
                          className="text-sm hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.patient.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{c.serviceName}</TableCell>
                    <TableCell className="text-sm">{c.vendor?.name || '—'}</TableCell>
                    <TableCell
                      className={`text-xs ${overdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}
                    >
                      {dueDate ? format(dueDate, 'MMM d') : '—'}
                      {overdue && ' (overdue)'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.cost != null && c.cost > 0 ? `GHS ${formatAmount(Number(c.cost))}` : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[c.status]} className="text-[10px]">
                        {STATUS_LABELS[c.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Pagination
        currentPage={page}
        totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        onPageChange={setPage}
        totalItems={total}
        pageSize={PAGE_SIZE}
        itemLabel="cases"
      />

      <LabCaseFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        vendors={vendors}
        onSaved={() => {
          setCreateOpen(false)
          queryClient.invalidateQueries({ queryKey: queryKeys.labs.all })
        }}
      />
    </div>
  )
}
