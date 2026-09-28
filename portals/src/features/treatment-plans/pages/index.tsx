import { useQuery } from '@tanstack/react-query'
import { FileText, Pencil, Plus, Printer, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'
import { formatCurrency, formatCurrencyCompact } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
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

type PlanStatus = 'draft' | 'presented' | 'accepted' | 'in_progress' | 'completed' | 'declined'

interface TreatmentPlan {
  id: string
  patientId: string
  patientName: string | null
  title: string
  status: PlanStatus
  totalEstimated: number | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

const STATUS_FILTERS: Array<{ value: 'all' | PlanStatus; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'presented', label: 'Presented' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'declined', label: 'Declined' },
]

const STATUS_BADGE_CLASS: Record<PlanStatus, string> = {
  draft: 'bg-slate-100 text-foreground dark:bg-slate-800 dark:text-slate-300',
  presented: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  accepted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  declined: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

const STATUS_LABEL: Record<PlanStatus, string> = {
  draft: 'Draft',
  presented: 'Presented',
  accepted: 'Accepted',
  in_progress: 'In progress',
  completed: 'Completed',
  declined: 'Declined',
}

function StatusBadge({ status }: { status: PlanStatus }) {
  return (
    <Badge variant="outline" className={STATUS_BADGE_CLASS[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  )
}

function formatUpdated(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GH', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export default function TreatmentPlansListPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<'all' | PlanStatus>('all')
  const [search, setSearch] = useState('')

  const {
    data: plans = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: queryKeys.treatmentPlans.list(),
    queryFn: async () => {
      const res = await api.get<TreatmentPlan[]>('/api/treatment-plans')
      return res.success && res.data ? res.data : []
    },
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return plans.filter((plan) => {
      if (statusFilter !== 'all' && plan.status !== statusFilter) return false
      if (
        q &&
        !(plan.patientName?.toLowerCase().includes(q) || plan.title.toLowerCase().includes(q))
      )
        return false
      return true
    })
  }, [plans, statusFilter, search])

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Treatment Plans</h1>
          <p className="text-muted-foreground mt-1">
            Visit-based plans with line items, acceptance, and consent.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button onClick={() => toast.info('New Plan — editor coming soon.')}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Plan
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:w-64">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as 'all' | PlanStatus)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:w-80">
          <Input
            placeholder="Search by patient or plan name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="text-xs text-muted-foreground sm:ml-auto">
          {isLoading ? '—' : `${filtered.length} plan${filtered.length === 1 ? '' : 's'}`}
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plan name</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Estimated</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-16">
                  <div className="flex flex-col items-center gap-2">
                    <FileText className="h-8 w-8 text-muted-foreground/40" />
                    <span>No treatment plans match your filters.</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((plan) => (
                <TableRow
                  key={plan.id}
                  onClick={() => navigate(`/clinical/treatment-plans/${plan.id}`)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium">{plan.title}</TableCell>
                  <TableCell>{plan.patientName ?? '—'}</TableCell>
                  <TableCell>
                    <StatusBadge status={plan.status} />
                  </TableCell>
                  <TableCell
                    className="text-right font-mono text-sm"
                    title={formatCurrency(plan.totalEstimated ?? 0)}
                  >
                    {formatCurrencyCompact(plan.totalEstimated ?? 0)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatUpdated(plan.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/clinical/treatment-plans/${plan.id}`)
                        }}
                        title="View"
                        aria-label="View file"
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation()
                          toast.info('Edit — coming soon.')
                        }}
                        title="Edit"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation()
                          window.print()
                        }}
                        title="Print"
                        aria-label="Print"
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
