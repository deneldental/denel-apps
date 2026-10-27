import { formatDistanceToNow } from 'date-fns'
import { ChevronRight, ClipboardList, FileText, Loader2, Plus, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { CreateEstimateSheet } from '@/features/activity/components/create-estimate-sheet'
import { api } from '@/lib/api-client'
import { useCan } from '@/lib/permissions-context'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
import { ClinicalPagination } from './clinical-pagination'
import { ClinicalTreatmentPlanSheet } from './clinical-treatment-plan-sheet'

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25

// ─── Types ────────────────────────────────────────────────────────────────────

type TreatmentPlanRow = {
  id: string
  title: string
  status: string
  totalEstimated: number
  createdAt: string
  patient: { id: string; name: string; patientId: string | null }
  itemCount: number
  createdByName: string | null
  caseId?: string | null
  caseNumber?: string | null
  entityType?: 'plan' | 'estimate'
}

/**
 * The view is split by *what the row is* (an estimate awaiting confirmation vs a
 * treatment plan), not by status — status is a filter within each tab. Each tab
 * owns its own search, filters, sort and page.
 */
type EntityTab = 'estimates' | 'plans'

const ENTITY_TABS = [
  { key: 'estimates', label: 'Estimates', icon: FileText },
  { key: 'plans', label: 'Treatment Plans', icon: ClipboardList },
] as const

// ─── Filter config ────────────────────────────────────────────────────────────

/**
 * Plan status filter. The first block reproduces the status *groups* the old
 * sub-tabs exposed (staff triage by them); the second block narrows to a single
 * status. Completed / Declined are one status each, so they appear only once.
 */
const PLAN_STATUS_FILTERS = [
  { value: 'all', label: 'All statuses', statuses: [] as string[] },
  { value: 'pending', label: 'Pending', statuses: ['draft', 'presented'] },
  { value: 'active', label: 'Active', statuses: ['created', 'accepted', 'in_progress'] },
  { value: 'completed', label: 'Completed', statuses: ['completed'] },
  { value: 'declined', label: 'Declined', statuses: ['declined'] },
  { value: 'draft', label: 'Draft', statuses: ['draft'] },
  { value: 'presented', label: 'Presented', statuses: ['presented'] },
  { value: 'created', label: 'Created', statuses: ['created'] },
  { value: 'accepted', label: 'Accepted', statuses: ['accepted'] },
  { value: 'in_progress', label: 'In progress', statuses: ['in_progress'] },
] as const

/** Values above the separator in the status dropdown. */
const GROUPED_STATUS_VALUES = ['pending', 'active', 'completed', 'declined']

const PERIOD_FILTERS = [
  { value: 'all', label: 'All time', days: null },
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
] as const

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'amount_desc', label: 'Highest value' },
  { value: 'amount_asc', label: 'Lowest value' },
  { value: 'patient', label: 'Patient A–Z' },
] as const

type PlanStatusKey = (typeof PLAN_STATUS_FILTERS)[number]['value']
type PeriodKey = (typeof PERIOD_FILTERS)[number]['value']
type SortKey = (typeof SORT_OPTIONS)[number]['value']

type TabState = {
  search: string
  status: PlanStatusKey
  period: PeriodKey
  sort: SortKey
  page: number
}

const DEFAULT_TAB_STATE: TabState = {
  search: '',
  status: 'all',
  period: 'all',
  sort: 'newest',
  page: 1,
}

// ─── Status presentation ──────────────────────────────────────────────────────

const PLAN_STATUS_COLORS: Record<string, string> = {
  draft: 'text-muted-foreground',
  presented: 'text-sky-700 border-sky-200 bg-sky-50 dark:text-sky-400',
  created: 'text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400',
  accepted: 'text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400',
  in_progress: 'text-amber-700 border-amber-200 bg-amber-50 dark:text-amber-400',
  completed: 'text-violet-700 border-violet-200 bg-violet-50 dark:text-violet-400',
  declined: 'text-destructive',
}

// §5.3 — subtle left-accent border per plan status (mirrors the pill colour, §2.1 pattern)
// so each plan row is identifiable at a glance. Static classes (Tailwind purges dynamic).
const PLAN_STATUS_BORDER: Record<string, string> = {
  draft: 'border-l-border',
  presented: 'border-l-sky-400',
  created: 'border-l-emerald-400',
  accepted: 'border-l-emerald-400',
  in_progress: 'border-l-amber-400',
  completed: 'border-l-violet-400',
  declined: 'border-l-destructive',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ClinicalTreatmentsTab() {
  // F38: offer "New Estimate" only where the server will accept it.
  const canCreateEstimate = useCan('estimates', 'create')
  const [tab, setTab] = useState<EntityTab>('estimates')
  const [filters, setFilters] = useState<Record<EntityTab, TabState>>({
    estimates: { ...DEFAULT_TAB_STATE },
    plans: { ...DEFAULT_TAB_STATE },
  })
  const current = filters[tab]

  const [rows, setRows] = useState<TreatmentPlanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [selectedPatient, setSelectedPatient] = useState<{
    id: string
    name: string
    patientId: string | null
  } | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  // New-estimate flow: pick a patient, then build the estimate. Estimates
  // created here are standalone (no appointment) — they land as draft invoices
  // for reception to confirm.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [estimateToPromote, setEstimateToPromote] = useState<TreatmentPlanRow | null>(null)
  const [promoting, setPromoting] = useState(false)

  // Guards against a slower earlier request landing after a newer one (tab flipping).
  const requestRef = useRef(0)

  const patch = useCallback(
    (next: Partial<TabState>) => {
      setFilters((prev) => ({ ...prev, [tab]: { ...prev[tab], ...next } }))
    },
    [tab]
  )

  // Debounce search for the active tab.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(current.search), 300)
    return () => clearTimeout(t)
  }, [current.search])

  function switchTab(next: EntityTab) {
    if (next === tab) return
    setTab(next)
    // Adopt the target tab's search immediately, otherwise the debounce would fire
    // one fetch with the previous tab's term.
    setDebouncedSearch(filters[next].search)
    setRows([])
    setLoading(true)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const reqId = ++requestRef.current

    const params = new URLSearchParams()
    params.set('entityType', tab === 'estimates' ? 'estimate' : 'plan')
    if (tab === 'plans') {
      const statuses = PLAN_STATUS_FILTERS.find((f) => f.value === current.status)?.statuses ?? []
      if (statuses.length > 0) params.set('status', statuses.join(','))
    }
    if (debouncedSearch) params.set('search', debouncedSearch)

    const res = await api.get<TreatmentPlanRow[]>(`/api/treatment-plans?${params}`)
    if (reqId !== requestRef.current) return // superseded
    setRows(res.success && res.data ? (res.data as TreatmentPlanRow[]) : [])
    setLoading(false)
  }, [tab, current.status, debouncedSearch])

  useEffect(() => {
    load()
  }, [load])

  // Period + sort are applied client-side: the endpoint returns the whole filtered
  // set (capped at 500 server-side) rather than a server-paged window.
  const visibleRows = useMemo(() => {
    let out = rows
    const days = PERIOD_FILTERS.find((p) => p.value === current.period)?.days
    if (days) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
      out = out.filter((r) => new Date(r.createdAt).getTime() >= cutoff)
    }

    const sorted = [...out]
    const time = (r: TreatmentPlanRow) => new Date(r.createdAt).getTime()
    switch (current.sort) {
      case 'oldest':
        sorted.sort((a, b) => time(a) - time(b))
        break
      case 'amount_desc':
        sorted.sort((a, b) => Number(b.totalEstimated) - Number(a.totalEstimated))
        break
      case 'amount_asc':
        sorted.sort((a, b) => Number(a.totalEstimated) - Number(b.totalEstimated))
        break
      case 'patient':
        sorted.sort((a, b) => (a.patient?.name ?? '').localeCompare(b.patient?.name ?? ''))
        break
      default:
        sorted.sort((a, b) => time(b) - time(a))
    }
    return sorted
  }, [rows, current.period, current.sort])

  const pagedRows = useMemo(
    () => visibleRows.slice((current.page - 1) * PAGE_SIZE, current.page * PAGE_SIZE),
    [visibleRows, current.page]
  )

  // A filter change can shrink the set past the current page — pull the user back
  // to the last page that still has rows instead of showing an empty table.
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE))
    if (current.page > maxPage) patch({ page: maxPage })
  }, [visibleRows.length, current.page, patch])

  const isEstimates = tab === 'estimates'
  const filtersDirty =
    current.search !== DEFAULT_TAB_STATE.search ||
    current.status !== DEFAULT_TAB_STATE.status ||
    current.period !== DEFAULT_TAB_STATE.period ||
    current.sort !== DEFAULT_TAB_STATE.sort

  function resetFilters() {
    setFilters((prev) => ({ ...prev, [tab]: { ...DEFAULT_TAB_STATE } }))
    setDebouncedSearch('')
  }

  function openRow(row: TreatmentPlanRow) {
    if (row.entityType === 'estimate') {
      setEstimateToPromote(row)
    } else {
      setSelectedPlanId(row.id)
      setSelectedPatient(row.patient)
      setSheetOpen(true)
    }
  }

  async function handlePromoteEstimate() {
    if (!estimateToPromote) return
    setPromoting(true)
    try {
      const res = await api.post('/api/treatment-plans/from-invoice', {
        invoiceId: estimateToPromote.id,
      })
      if (res.success && res.data) {
        toast.success('Estimate promoted to treatment plan successfully.')
        setEstimateToPromote(null)
        void load()
        // Automatically open the new plan
        setSelectedPlanId((res.data as { id: string }).id)
        setSelectedPatient(estimateToPromote.patient)
        setSheetOpen(true)
      } else {
        toast.error(res.error || 'Failed to promote estimate')
      }
    } catch {
      toast.error('An error occurred while promoting the estimate.')
    } finally {
      setPromoting(false)
    }
  }

  function handlePlanUpdated(planId: string, newStatus: string) {
    setRows((prev) => prev.map((p) => (p.id === planId ? { ...p, status: newStatus } : p)))
  }

  return (
    <div className="p-6 space-y-4">
      {/* Entity tabs — what the row is, not what state it's in. */}
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
        {ENTITY_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => switchTab(key)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Per-tab toolbar: search + filters + create */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search by patient name…"
          value={current.search}
          onChange={(e) => patch({ search: e.target.value, page: 1 })}
          className="h-8 w-full max-w-xs text-sm"
        />

        {/* Estimates are draft invoices by definition — a status filter would have a
            single value, so the tab filters on period + sort only. */}
        {!isEstimates && (
          <Select
            value={current.status}
            onValueChange={(v) => patch({ status: v as PlanStatusKey, page: 1 })}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="text-xs">Groups</SelectLabel>
                {PLAN_STATUS_FILTERS.filter((f) => GROUPED_STATUS_VALUES.includes(f.value)).map(
                  (f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  )
                )}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="text-xs">Exact status</SelectLabel>
                {PLAN_STATUS_FILTERS.filter(
                  (f) => f.value !== 'all' && !GROUPED_STATUS_VALUES.includes(f.value)
                ).map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}

        <Select
          value={current.period}
          onValueChange={(v) => patch({ period: v as PeriodKey, page: 1 })}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue placeholder="Period" />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_FILTERS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={current.sort} onValueChange={(v) => patch({ sort: v as SortKey, page: 1 })}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtersDirty && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={resetFilters}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        )}

        <div className="flex-1" />
        {canCreateEstimate && (
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setPickerOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            New Estimate
          </Button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          {isEstimates ? (
            <FileText className="h-10 w-10 text-muted-foreground/40" />
          ) : (
            <ClipboardList className="h-10 w-10 text-muted-foreground/40" />
          )}
          <div>
            <p className="font-medium text-muted-foreground">
              {isEstimates ? 'No estimates found' : 'No treatment plans found'}
            </p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {filtersDirty
                ? 'Try adjusting your filters.'
                : isEstimates
                  ? 'Estimates awaiting reception confirmation will appear here.'
                  : 'Plans appear here once an estimate is promoted or a case plan is created.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>{isEstimates ? 'Estimate' : 'Case'}</TableHead>
                <TableHead className="w-[110px]">Procedures</TableHead>
                <TableHead className="w-[120px] text-right">Est. Total</TableHead>
                <TableHead className="w-[140px]">{isEstimates ? 'Created by' : 'Status'}</TableHead>
                <TableHead className="w-[140px]">Created</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    'cursor-pointer border-l-4',
                    isEstimates
                      ? 'border-l-amber-400'
                      : (PLAN_STATUS_BORDER[row.status] ?? 'border-l-border')
                  )}
                  onClick={() => openRow(row)}
                >
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">
                        {row.patient?.name ?? 'Unknown patient'}
                      </p>
                      {row.patient?.patientId && (
                        <p className="text-xs text-muted-foreground font-mono">
                          {row.patient.patientId}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell
                    className="text-sm max-w-xs truncate"
                    onClick={(e) => {
                      if (row.caseId) e.stopPropagation()
                    }}
                  >
                    {row.caseId && row.caseNumber ? (
                      <Link
                        to={`/patients/${row.patient.id}/cases/${row.caseId}`}
                        className="font-mono font-medium text-primary hover:underline"
                        title={row.title ?? undefined}
                      >
                        {row.caseNumber}
                      </Link>
                    ) : (
                      (row.title ?? (isEstimates ? 'Estimate' : 'Treatment Plan'))
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {row.itemCount}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium tabular-nums">
                    GHS {formatAmount(Number(row.totalEstimated))}
                  </TableCell>
                  <TableCell>
                    {isEstimates ? (
                      <span className="text-xs text-muted-foreground">
                        {row.createdByName ?? '—'}
                      </span>
                    ) : (
                      <Badge
                        variant="outline"
                        className={`text-xs capitalize ${PLAN_STATUS_COLORS[row.status] ?? ''}`}
                      >
                        {row.status.replace('_', ' ')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <span title={new Date(row.createdAt).toLocaleString()}>
                      {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
                    </span>
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* §5.1 — per-tab pagination over the filtered set */}
      {!loading && visibleRows.length > 0 && (
        <ClinicalPagination
          page={current.page}
          pageSize={PAGE_SIZE}
          rowCount={pagedRows.length}
          total={visibleRows.length}
          onPageChange={(p) => patch({ page: p })}
        />
      )}

      {/* New estimate — priced service builder. */}
      <CreateEstimateSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onCreated={() => {
          setPickerOpen(false)
          void load()
        }}
      />

      {/* Detail sheet */}
      {selectedPlanId && selectedPatient && (
        <ClinicalTreatmentPlanSheet
          planId={selectedPlanId}
          patient={selectedPatient}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          onPlanUpdated={handlePlanUpdated}
        />
      )}

      {/* Promote Estimate Dialog */}
      <AlertDialog
        open={!!estimateToPromote}
        onOpenChange={(o) => {
          if (!o && !promoting) setEstimateToPromote(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Promote Estimate to Treatment Plan</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a new treatment plan from this estimate for{' '}
              <span className="font-semibold text-foreground">
                {estimateToPromote?.patient?.name}
              </span>
              . You can modify the procedures and status after the plan is created.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={promoting}>Cancel</AlertDialogCancel>
            <Button disabled={promoting} onClick={handlePromoteEstimate}>
              {promoting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Promoting...
                </>
              ) : (
                'Promote to Plan'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
