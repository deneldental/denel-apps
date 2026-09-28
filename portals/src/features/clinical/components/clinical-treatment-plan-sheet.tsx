import { format, isValid, parseISO } from 'date-fns'
import { ChevronDown, ExternalLink, MoreHorizontal, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { CreateEstimateSheet } from '@/features/activity/components/create-estimate-sheet'
import { useToothNotation } from '@/features/clinical/use-clinical-preferences'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/components/ui/sheet'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { surfaceApiError } from '@/shared/lib/api-error'
import { formatAmount } from '@/shared/utils/currency'

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_PLAN_STATUSES = [
  'draft',
  'presented',
  'created',
  'accepted',
  'in_progress',
  'completed',
  'declined',
] as const
type PlanStatus = (typeof VALID_PLAN_STATUSES)[number]

const VALID_ITEM_STATUSES = ['pending', 'scheduled', 'completed', 'cancelled'] as const
type ItemStatus = (typeof VALID_ITEM_STATUSES)[number]

function isValidPlanStatus(s: string): s is PlanStatus {
  return (VALID_PLAN_STATUSES as readonly string[]).includes(s)
}

function isValidItemStatus(s: string): s is ItemStatus {
  return (VALID_ITEM_STATUSES as readonly string[]).includes(s)
}

// ─── Types ────────────────────────────────────────────────────────────────────

type PlanItem = {
  id: string
  // §6.3 — catalog link; null for legacy/off-catalog free-text items.
  serviceId: string | null
  procedureName: string
  toothNumber: number | null
  phase: number | null
  estimatedCost: number | null
  status: string | null
  notes: string | null
  sortOrder: number | null
}

type FullPlan = {
  id: string
  title: string
  status: string
  totalEstimated: number
  createdAt: string
  notes: string | null
  patientId: string
  items: PlanItem[]
  /** Every plan belongs to a case — the case number is the heading staff quote. */
  caseId: string | null
  caseNumber: string | null
}

type PatientInfo = {
  /** The patient's UUID — this is what the API takes. */
  id: string
  name: string
  /** The human-readable patient code (e.g. `#TEST001`) — display only, never an API key. */
  patientId: string | null
}

// §6.3 — catalog service shape (subset of /api/services we use here).
type Service = {
  id: string
  name: string
  amount: number
  currency?: string
  category?: string
}

const PLAN_STATUS_COLORS: Record<string, string> = {
  draft: 'text-muted-foreground',
  presented: 'text-sky-700 border-sky-200 bg-sky-50 dark:text-sky-400',
  created: 'text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400',
  accepted: 'text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400',
  in_progress: 'text-amber-700 border-amber-200 bg-amber-50 dark:text-amber-400',
  completed: 'text-violet-700 border-violet-200 bg-violet-50 dark:text-violet-400',
  declined: 'text-destructive',
}

const ITEM_STATUS_COLORS: Record<string, string> = {
  pending: 'text-muted-foreground',
  scheduled: 'text-sky-700 border-sky-200 bg-sky-50 dark:text-sky-400',
  completed: 'text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400',
  cancelled: 'text-destructive',
}

// §5.3 — subtle left-accent border per status (mirrors the pill colour, §2.1 pattern)
// so each plan/procedure card is identifiable at a glance. Static classes (Tailwind purges
// dynamic). Keyed off the same status palette as PLAN_STATUS_COLORS / ITEM_STATUS_COLORS.
const PLAN_STATUS_BORDER: Record<string, string> = {
  draft: 'border-l-border',
  presented: 'border-l-sky-400',
  created: 'border-l-emerald-400',
  accepted: 'border-l-emerald-400',
  in_progress: 'border-l-amber-400',
  completed: 'border-l-violet-400',
  declined: 'border-l-destructive',
}

const ITEM_STATUS_BORDER: Record<string, string> = {
  pending: 'border-l-border',
  scheduled: 'border-l-sky-400',
  completed: 'border-l-emerald-400',
  cancelled: 'border-l-destructive',
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  planId: string
  patient: PatientInfo
  open: boolean
  onOpenChange: (open: boolean) => void
  onPlanUpdated?: (planId: string, newStatus: string) => void
}

export function ClinicalTreatmentPlanSheet({
  planId,
  patient,
  open,
  onOpenChange,
  onPlanUpdated,
}: Props) {
  const { toothLabel } = useToothNotation()
  const [plan, setPlan] = useState<FullPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [openItemIds, setOpenItemIds] = useState<Set<string>>(new Set())
  const [updatingPlanStatus, setUpdatingPlanStatus] = useState(false)
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null)
  const [showSupplemental, setShowSupplemental] = useState(false)
  const [selectedStatus, setSelectedStatus] = useState<string>('created')
  const [saving, setSaving] = useState(false)

  // Single derived lock — disables ALL interactive controls while any request is in-flight.
  const isAnyMutating = updatingPlanStatus || updatingItemId !== null || saving

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    const res = await api.get<FullPlan>(`/api/treatment-plans/${planId}`)
    if (res.success && res.data) {
      setPlan(res.data as FullPlan)
      setSelectedStatus(res.data.status)
    } else {
      setLoadError(true)
    }
    setLoading(false)
  }, [planId])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  function toggleItem(id: string) {
    setOpenItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function _updatePlanStatus(status: string) {
    if (!plan) return
    if (!isValidPlanStatus(status)) {
      toast.error('Invalid plan status')
      return
    }
    setUpdatingPlanStatus(true)
    try {
      const res = await api.patch(`/api/treatment-plans/${planId}`, { status })
      if (res.success) {
        toast.success(`Plan marked as ${status.replace('_', ' ')}`)
        setPlan((prev) => (prev ? { ...prev, status } : prev))
        onPlanUpdated?.(planId, status)
      } else {
        surfaceApiError(res, 'Failed to update plan status')
      }
    } finally {
      setUpdatingPlanStatus(false)
    }
  }

  async function updateItemStatus(itemId: string, status: string) {
    if (!plan) return
    if (!isValidItemStatus(status)) {
      toast.error('Invalid item status')
      return
    }
    // The backend has no per-item sub-route; use the existing replace-items path on
    // PATCH /api/treatment-plans/:id by sending the full updated items array.
    const updatedItems = plan.items.map((it) => (it.id === itemId ? { ...it, status } : it))
    setUpdatingItemId(itemId)
    try {
      const res = await api.patch(`/api/treatment-plans/${planId}`, { items: updatedItems })
      if (res.success) {
        toast.success('Item status updated')
        setPlan((prev) => (prev ? { ...prev, items: updatedItems } : prev))
      } else {
        surfaceApiError(res, 'Failed to update item status')
      }
    } finally {
      setUpdatingItemId(null)
    }
  }

  // Block closing while any mutation is in-flight (green low ux: no close during mutation).
  function handleOpenChange(next: boolean) {
    if (!next && isAnyMutating) return
    onOpenChange(next)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto" aria-describedby={undefined}>
        {loading ? (
          <div className="space-y-4 pt-6">
            <SheetTitle className="sr-only">Loading plan</SheetTitle>
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            {['sk-0', 'sk-1', 'sk-2'].map((k) => (
              <Skeleton key={k} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : loadError || !plan ? (
          <div className="flex flex-col items-center justify-center gap-3 pt-16 text-center">
            <SheetTitle className="sr-only">Error loading plan</SheetTitle>
            <p className="text-sm text-muted-foreground">
              Failed to load treatment plan. Please try again.
            </p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            <SheetHeader
              className={cn(
                'pb-4 border-b border-l-4 pl-3 -ml-3 rounded-l-sm',
                PLAN_STATUS_BORDER[plan.status] ?? 'border-l-border'
              )}
            >
              {/* Patient header */}
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {patient.name}
                </p>
                {patient.patientId && (
                  <Badge variant="outline" className="font-mono text-[10px] h-4 px-1.5">
                    {patient.patientId}
                  </Badge>
                )}
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {plan.caseId && plan.caseNumber ? (
                    <>
                      <SheetTitle className="text-base leading-snug">
                        <Link
                          to={`/patients/${patient.id}/cases/${plan.caseId}`}
                          className="font-mono text-primary hover:underline"
                        >
                          {plan.caseNumber}
                        </Link>
                      </SheetTitle>
                      {plan.title && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {plan.title}
                        </p>
                      )}
                    </>
                  ) : (
                    <SheetTitle className="text-base leading-snug">{plan.title}</SheetTitle>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={PLAN_STATUS_COLORS[plan.status] ?? ''}>
                    {plan.status.replace('_', ' ')}
                  </Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={isAnyMutating}
                        aria-label="More options"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`/patients/${patient.id}`}>
                          <ExternalLink className="h-3.5 w-3.5 mr-2" />
                          View patient
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Summary row */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                <span>
                  <span className="font-medium text-foreground/70">Total</span> GHS{' '}
                  {formatAmount(Number(plan.totalEstimated))}
                </span>
                <span>
                  <span className="font-medium text-foreground/70">Created</span> {(() => {
                    const d = parseISO(plan.createdAt)
                    return isValid(d) ? format(d, 'MMM d, yyyy') : 'Unknown date'
                  })()}
                </span>
                <span>
                  <span className="font-medium text-foreground/70">Procedures</span>{' '}
                  {plan.items.length}
                </span>
              </div>
            </SheetHeader>

            {/* Items accordion */}
            <div className="pt-4 space-y-2">
              {plan.items.length === 0 ? (
                <p className="text-sm text-muted-foreground italic text-center py-8">
                  No procedures recorded.
                </p>
              ) : (
                plan.items.map((item) => {
                  const isOpen = openItemIds.has(item.id)
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'rounded-lg border border-l-4 border-border overflow-hidden',
                        ITEM_STATUS_BORDER[item.status ?? 'pending'] ?? 'border-l-border'
                      )}
                    >
                      <button
                        type="button"
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
                        onClick={() => toggleItem(item.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] h-4 px-1.5 shrink-0',
                                ITEM_STATUS_COLORS[item.status ?? ''] ?? ''
                              )}
                            >
                              {item.status ?? 'pending'}
                            </Badge>
                            <span className="text-sm font-medium truncate">
                              {item.procedureName}
                            </span>
                            {item.toothNumber && (
                              <span className="text-xs text-muted-foreground shrink-0">
                                Tooth {toothLabel(item.toothNumber)}
                              </span>
                            )}
                          </div>
                          {item.estimatedCost != null && item.estimatedCost > 0 && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              GHS {formatAmount(Number(item.estimatedCost))}
                            </p>
                          )}
                        </div>
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0',
                            isOpen && 'rotate-180'
                          )}
                        />
                      </button>

                      {isOpen && (
                        <div className="px-4 py-3 border-t border-border space-y-3">
                          {item.notes && (
                            <p className="text-sm text-muted-foreground">{item.notes}</p>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Status:</span>
                            <Select
                              value={item.status ?? 'pending'}
                              onValueChange={(v) => updateItemStatus(item.id, v)}
                              disabled={isAnyMutating}
                            >
                              <SelectTrigger className="h-7 w-[140px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="scheduled">Scheduled</SelectItem>
                                <SelectItem value="completed">Completed</SelectItem>
                                <SelectItem value="cancelled">Cancelled</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}

              {plan.notes && (
                <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Plan notes</p>
                  <p className="text-sm">{plan.notes}</p>
                </div>
              )}

              <div className="pt-2">
                <Button
                  variant="outline"
                  className="w-full border-dashed"
                  disabled={isAnyMutating}
                  onClick={() => setShowSupplemental(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Supplemental Estimate
                </Button>
              </div>

              {showSupplemental && (
                <CreateEstimateSheet
                  patientId={patient.id}
                  patientName={patient.name}
                  planId={planId}
                  open={showSupplemental}
                  onOpenChange={setShowSupplemental}
                  onCreated={() => {
                    setShowSupplemental(false)
                    load()
                  }}
                />
              )}

              {/* Status and Save Footer */}
              <div className="mt-8 border-t pt-4 flex flex-col gap-3">
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Plan Status</span>
                  <div className="flex flex-wrap gap-2">
                    {['in_progress', 'completed', 'declined'].map((status) => {
                      const isActive = selectedStatus === status
                      return (
                        <button
                          key={status}
                          type="button"
                          onClick={() => setSelectedStatus(status)}
                          className={cn(
                            'px-3 py-1.5 text-xs font-medium rounded-md border transition-all capitalize',
                            isActive
                              ? 'bg-primary border-primary text-primary-foreground shadow-sm'
                              : 'bg-background border-input text-muted-foreground hover:text-foreground hover:bg-muted/50'
                          )}
                        >
                          {status.replace('_', ' ')}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-2 w-full">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => onOpenChange(false)}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={async () => {
                      setSaving(true)
                      try {
                        const res = await api.patch(`/api/treatment-plans/${planId}`, {
                          status: selectedStatus,
                        })
                        if (res.success) {
                          toast.success('Treatment plan updated successfully')
                          onPlanUpdated?.(planId, selectedStatus)
                          onOpenChange(false)
                        } else {
                          surfaceApiError(res, 'Failed to save treatment plan')
                        }
                      } finally {
                        setSaving(false)
                      }
                    }}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
