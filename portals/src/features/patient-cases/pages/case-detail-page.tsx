import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Printer,
  Trash2,
  Unlock,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ClinicalTreatmentPlanSheet } from '@/features/clinical/components/clinical-treatment-plan-sheet'
import { api } from '@/lib/api-client'
import { useCan } from '@/lib/permissions-context'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  type OverridePayload,
  useTreatmentGateOverride,
} from '@/shared/hooks/use-treatment-gate-override'
import { surfaceApiError } from '@/shared/lib/api-error'
import { AddStageSheet } from '../components/add-stage-sheet'
import type { CaseStage } from '../components/case-detail-sheet'
import { CasePrintSheet } from '../components/case-print-sheet'
import { StageDataView } from '../components/stage-detail-sheet'

// ─── Types ────────────────────────────────────────────────────────────────────

type FullCase = {
  id: string
  caseNumber: string
  status: 'open' | 'closed'
  chiefComplaint: string | null
  createdAt: string
  createdBy: { id: string; name: string } | null
  stages: CaseStage[]
  plan?: { id: string; title: string; totalEstimated: string; status: string } | null
  planItems?: {
    id: string
    planId: string
    procedureName: string
    serviceId: string | null
    estimatedCost: string
    status: string
    sortOrder: number
  }[]
}

// ─── Stage meta ───────────────────────────────────────────────────────────────

const STAGE_META: Record<string, { label: string }> = {
  patient_concern: { label: 'Patient Concern' },
  oral_health: { label: 'Oral Health' },
  // §2.3 — examination before diagnosis
  examination: { label: 'Examination' },
  diagnosis: { label: 'Diagnosis' },
  treatment_plan: { label: 'Treatment Plan' },
  prescription: { label: 'Prescription' },
  // §2.5 — merged Review stage; legacy entries kept readable
  review: { label: 'Review' },
  dental_review: { label: 'Dental Review' },
  ortho_review: { label: 'Ortho Review' },
}

// ─── Visit grouping ───────────────────────────────────────────────────────────
// Stages are grouped into "visits" by their visitDate (the clinical day), so the
// timeline reads as: #14 Mar → stages · #18 Mar → stages. Falls back to the
// creation date for any legacy stage with no visitDate.

function visitKeyOf(stage: CaseStage): string {
  return stage.visitDate ?? format(new Date(stage.createdAt), 'yyyy-MM-dd')
}

function groupStagesByVisit(stages: CaseStage[]): { key: string; stages: CaseStage[] }[] {
  const map = new Map<string, CaseStage[]>()
  for (const s of stages) {
    const key = visitKeyOf(s)
    const arr = map.get(key) ?? []
    arr.push(s)
    map.set(key, arr)
  }
  // YYYY-MM-DD keys sort chronologically as plain strings — oldest visit first.
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, groupStages]) => ({ key, stages: groupStages }))
}

function formatVisitDate(key: string): string {
  try {
    return format(parseISO(key), 'EEE, d MMM yyyy')
  } catch {
    return key
  }
}

// ─── Plan item completion prompt ──────────────────────────────────────────────
// Asks whether the treatment-plan item this visit's stages belong to is done.
// Once answered — either way — the card greys out and keeps only the chosen
// option (disabled) plus `Undo`, so the prompt reads as spent but a mis-click is
// still correctable.
//
// "Yes" is durable: it writes status='completed'. "No" is not — the item stays
// 'pending', which is also the untouched default, so the answer can't be told
// apart from "never asked" in the data. `answeredNo` therefore carries it for
// the session only; a reload puts the question back, which is honest — the work
// still isn't done.

function PlanItemCompletionCard({
  planItem,
  answeredNo,
  isSaving,
  onAnswer,
  onUndo,
}: {
  planItem: { id: string; procedureName: string; status: string }
  answeredNo: boolean
  isSaving: boolean
  onAnswer: (answer: 'yes' | 'no') => void
  onUndo: () => void
}) {
  const isCompleted = planItem.status === 'completed'
  const isAnswered = isCompleted || answeredNo

  return (
    <div className="mt-4 border-t pt-4">
      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-md border p-3 transition-colors',
          isAnswered ? 'border-dashed bg-muted/50' : 'bg-card shadow-sm'
        )}
      >
        <span className={cn('text-sm font-medium', isAnswered && 'text-muted-foreground')}>
          Is "{planItem.procedureName}" completed?
        </span>

        {isAnswered ? (
          <div className="flex shrink-0 items-center gap-2">
            {/* The chosen answer, disabled — the card is a record now, not a prompt. */}
            <Button
              size="sm"
              disabled
              variant={isCompleted ? 'default' : 'outline'}
              className={cn(
                'disabled:opacity-100',
                isCompleted && 'bg-emerald-600 text-white hover:bg-emerald-600'
              )}
            >
              {isCompleted ? (
                <>
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Yes
                </>
              ) : (
                'No'
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              disabled={isSaving}
              onClick={onUndo}
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Undo'}
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={isSaving}
              onClick={() => onAnswer('yes')}
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Yes'}
            </Button>
            <Button size="sm" variant="outline" disabled={isSaving} onClick={() => onAnswer('no')}>
              No
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CaseDetailPage() {
  const { patientId, caseId } = useParams<{ patientId: string; caseId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  // Where back/breadcrumb should route. Defaults to the patient page; navigators
  // (e.g. the clinical /cases list) can pass `state: { from: '/cases' }` so
  // back takes the user to wherever they came from.
  const backTo =
    (location.state as { from?: string } | null)?.from ?? `/patients/${patientId}?tab=medical`

  const [caseData, setCaseData] = useState<FullCase | null>(null)
  const [patientName, setPatientName] = useState<string>('')
  const [loading, setLoading] = useState(true)

  // Stage writes hit POST/PATCH/DELETE /api/patient-cases/:id/stages, which the
  // backend gates on `patients:update` — mirror that here rather than gating on
  // the role. (This used to be `role !== 'doctor'`, which locked doctors out of
  // the clinical timeline they are the ones meant to author.)
  const canEdit = useCan('patients', 'update')

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetStage, setSheetStage] = useState<CaseStage | null>(null)
  const [deleteStageId, setDeleteStageId] = useState<string | null>(null)
  const [togglingStatus, setTogglingStatus] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [planSheetOpen, setPlanSheetOpen] = useState(false)
  const [savingPlanItemId, setSavingPlanItemId] = useState<string | null>(null)
  const { promptOverride, overrideDialog } = useTreatmentGateOverride()
  // Plan items explicitly answered "No" this session — see PlanItemCompletionCard.
  const [answeredNoIds, setAnsweredNoIds] = useState<Set<string>>(new Set())

  // Calendar State
  const [calendarOpen, setCalendarOpen] = useState(true)
  const [currentMonth, setCurrentMonth] = useState(() => new Date())
  const [selectedVisitDate, setSelectedVisitDate] = useState<string | null>(null)

  // Pending Carry Over State
  const [pendingCarryOver, setPendingCarryOver] = useState<CaseStage | null>(null)

  const load = useCallback(async () => {
    if (!patientId || !caseId) return
    setLoading(true)

    const [caseRes, patientRes] = await Promise.all([
      api.get<FullCase>(`/api/patient-cases/${caseId}`),
      api.get<{ name: string }>(`/api/patients/${patientId}`),
    ])

    if (caseRes.success && caseRes.data) {
      const data = caseRes.data as FullCase
      setCaseData(data)
      // Default: select the latest visit date on load if none selected
      if (data.stages.length > 0) {
        const groups = groupStagesByVisit(data.stages)
        const latestKey = groups[groups.length - 1].key
        setSelectedVisitDate((prev) => {
          if (!prev) {
            setCurrentMonth(parseISO(latestKey))
            return latestKey
          }
          return prev
        })
      }
    } else {
      toast.error('Case not found')
      navigate(`/patients/${patientId}?tab=medical`)
      return
    }

    if (patientRes.success && patientRes.data) {
      setPatientName((patientRes.data as { name?: string }).name ?? '')
    }

    setLoading(false)
  }, [patientId, caseId, navigate])

  useEffect(() => {
    load()
  }, [load])

  function toggleStage(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openAdd() {
    setSheetStage(null)
    setSheetOpen(true)
  }

  function openEdit(stage: CaseStage) {
    setSheetStage(stage)
    setSheetOpen(true)
  }

  async function handleToggleStatus() {
    if (!caseData || !caseId) return
    const newStatus = caseData.status === 'open' ? 'closed' : 'open'
    setTogglingStatus(true)
    const res = await api.patch(`/api/patient-cases/${caseId}`, { status: newStatus })
    if (res.success) {
      toast.success(newStatus === 'closed' ? 'Case closed' : 'Case reopened')
      setCaseData((prev) => (prev ? { ...prev, status: newStatus as 'open' | 'closed' } : prev))
    } else {
      toast.error('Failed to update case status')
    }
    setTogglingStatus(false)
  }

  async function _handleMoveStage(stageId: string, status: string) {
    if (!caseId) return
    const current = caseData?.stages.find((s) => s.id === stageId)
    if (!current || (current.status ?? 'planned') === status) return
    const prevStatus = current.status
    // Optimistic move — snap the card into the new column immediately.
    setCaseData((prev) =>
      prev
        ? { ...prev, stages: prev.stages.map((s) => (s.id === stageId ? { ...s, status } : s)) }
        : prev
    )
    const res = await api.patch(`/api/patient-cases/${caseId}/stages/${stageId}`, { status })
    if (!res.success) {
      toast.error('Failed to move stage')
      setCaseData((prev) =>
        prev
          ? {
              ...prev,
              stages: prev.stages.map((s) => (s.id === stageId ? { ...s, status: prevStatus } : s)),
            }
          : prev
      )
    }
  }

  async function handleDeleteStage() {
    if (!deleteStageId || !caseId) return
    const res = await api.delete(`/api/patient-cases/${caseId}/stages/${deleteStageId}`)
    if (res.success) {
      toast.success('Stage removed')
      setCaseData((prev) =>
        prev ? { ...prev, stages: prev.stages.filter((s) => s.id !== deleteStageId) } : prev
      )
    } else {
      toast.error('Failed to delete stage')
    }
    setDeleteStageId(null)
  }

  /**
   * Re-reads the case and swaps in only the slices the visit-details pane
   * renders (stages + plan items). Deliberately does not touch `loading`, the
   * selected visit, the current month, or the expanded stages — so answering a
   * question refreshes that pane in place instead of remounting the whole page.
   */
  const refreshVisitDetails = useCallback(async () => {
    if (!caseId) return
    const res = await api.get<FullCase>(`/api/patient-cases/${caseId}`)
    if (!res.success || !res.data) return
    const fresh = res.data as FullCase
    setCaseData((prev) =>
      prev ? { ...prev, stages: fresh.stages, plan: fresh.plan, planItems: fresh.planItems } : fresh
    )
  }, [caseId])

  async function handlePlanItemAnswer(
    planItemId: string,
    answer: 'yes' | 'no',
    override?: OverridePayload
  ) {
    const status = answer === 'yes' ? 'completed' : 'pending'
    setSavingPlanItemId(planItemId)
    const res = await api.patch(`/api/treatment-plans/items/${planItemId}`, {
      status,
      ...(override ?? {}),
    })
    if (res.success) {
      setAnsweredNoIds((prev) => {
        const next = new Set(prev)
        if (answer === 'no') next.add(planItemId)
        else next.delete(planItemId)
        return next
      })
      toast.success(answer === 'yes' ? 'Marked as completed' : 'Marked as not completed')
      await refreshVisitDetails()
    } else {
      // Marking an item completed IS treatment delivery, so this can come back
      // 402 from the payment gate. Offer an admin the audited override; anyone
      // else gets the server's reason, which names the outstanding balance.
      const offered =
        !override &&
        promptOverride(res, (payload) => handlePlanItemAnswer(planItemId, answer, payload))
      if (!offered) surfaceApiError(res, 'Failed to update')
    }
    setSavingPlanItemId(null)
  }

  /** Re-opens the prompt. Clearing a "No" is local-only — the item is already 'pending'. */
  async function handlePlanItemUndo(planItemId: string) {
    setAnsweredNoIds((prev) => {
      const next = new Set(prev)
      next.delete(planItemId)
      return next
    })

    const item = caseData?.planItems?.find((pi) => pi.id === planItemId)
    if (item?.status !== 'completed') return

    setSavingPlanItemId(planItemId)
    const res = await api.patch(`/api/treatment-plans/items/${planItemId}`, { status: 'pending' })
    if (res.success) {
      toast.success('Reopened')
      await refreshVisitDetails()
    } else {
      surfaceApiError(res, 'Failed to update')
    }
    setSavingPlanItemId(null)
  }

  async function handleDuplicateStage(stage: CaseStage, dateOverride?: string) {
    if (!caseId) return
    const res = await api.post(`/api/patient-cases/${caseId}/stages`, {
      stageType: stage.stageType,
      data: stage.data,
      status: 'planned',
      visitDate: dateOverride, // Optional override for pending additions
    })
    if (res.success && res.data) {
      toast.success(
        dateOverride ? 'Stage added to selected visit' : "Stage continued in today's visit"
      )
      const newStage = res.data as CaseStage
      setCaseData((prev) => (prev ? { ...prev, stages: [...prev.stages, newStage] } : prev))
      const key = visitKeyOf(newStage)
      setSelectedVisitDate(key)
      setCurrentMonth(parseISO(key))
      setExpandedIds((prev) => new Set(prev).add(newStage.id))
      setPendingCarryOver(null)
    } else {
      toast.error('Failed to duplicate stage')
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="border-b bg-background px-6 py-4">
          <Skeleton className="h-4 w-64 mb-3" />
          <Skeleton className="h-7 w-48" />
        </div>
        <div className="flex-1 overflow-auto p-6 space-y-4 max-w-3xl mx-auto w-full">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  if (!caseData) return null

  // Group visits by date
  const allGroups = groupStagesByVisit(caseData.stages)
  const visitsByDate = new Map(allGroups.map((g) => [g.key, g]))
  const selectedGroup = selectedVisitDate ? visitsByDate.get(selectedVisitDate) : null

  // Calendar logic (5x5 grid displaying ONLY actual visit dates for current month)
  const visitDatesInMonth = Array.from(visitsByDate.keys())
    .filter((dateStr) => {
      // Create date locally to compare months
      const [y, m, d] = dateStr.split('-').map(Number)
      const dateObj = new Date(y, m - 1, d)
      return isSameMonth(dateObj, currentMonth)
    })
    .sort()
    .map((dateStr) => {
      const [y, m, d] = dateStr.split('-').map(Number)
      return new Date(y, m - 1, d)
    })

  return (
    <>
      <div className="flex flex-col flex-1 min-h-0">
        {/* Breadcrumb + header */}
        <div className="border-b bg-background px-6 py-4 shrink-0">
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3">
            <Link to="/patients" className="hover:text-foreground transition-colors">
              Patients
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link
              to={`/patients/${patientId}?tab=medical`}
              className="hover:text-foreground transition-colors"
            >
              {patientName || 'Patient'}
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-foreground font-medium font-mono">{caseData.caseNumber}</span>
          </nav>

          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 -ml-2 shrink-0 mt-0.5"
                onClick={() => navigate(backTo)}
                aria-label="Go back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold tracking-tight font-mono">
                    {caseData.caseNumber}
                  </h1>
                  <Badge
                    variant="outline"
                    className={
                      caseData.status === 'open'
                        ? 'text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400'
                        : 'text-muted-foreground'
                    }
                  >
                    {caseData.status === 'open' ? 'Open' : 'Closed'}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground">
                  Created {format(new Date(caseData.createdAt), 'MMM d, yyyy')}
                  {caseData.createdBy ? ` by ${caseData.createdBy.name}` : ''}
                </p>

                {caseData.chiefComplaint && (
                  <p className="text-sm text-muted-foreground mt-1 leading-snug">
                    {caseData.chiefComplaint}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPrintOpen(true)}
                aria-label="Print case"
              >
                <Printer className="h-4 w-4" />
              </Button>
              {caseData.plan && (
                <Button variant="outline" size="sm" onClick={() => setPlanSheetOpen(true)}>
                  View Plan
                </Button>
              )}
              {canEdit && (
                <Button
                  variant={caseData.status === 'open' ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={handleToggleStatus}
                  disabled={togglingStatus}
                  className={
                    caseData.status === 'closed'
                      ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30'
                      : ''
                  }
                >
                  {caseData.status === 'open' ? (
                    <>
                      <Lock className="h-3.5 w-3.5 mr-1.5" />
                      Close case
                    </>
                  ) : (
                    <>
                      <Unlock className="h-3.5 w-3.5 mr-1.5" />
                      Reopen case
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-[1200px] mx-auto flex flex-col lg:flex-row gap-8">
            {/* Left: Calendar View — collapsible so the visit details can run full width */}
            <div className={cn('lg:w-4/12 flex-col space-y-4', calendarOpen ? 'flex' : 'hidden')}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-lg font-semibold tracking-tight">Visit Calendar</h2>
              </div>

              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <h3 className="text-base font-semibold">{format(currentMonth, 'MMMM yyyy')}</h3>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-5 gap-3">
                  {visitDatesInMonth.length === 0 ? (
                    <div className="col-span-5 py-8 text-center text-sm text-muted-foreground">
                      No visits recorded in {format(currentMonth, 'MMMM yyyy')}.
                    </div>
                  ) : (
                    visitDatesInMonth.map((day) => {
                      const dateStr = format(day, 'yyyy-MM-dd')
                      const visit = visitsByDate.get(dateStr)
                      const isSelected = selectedVisitDate === dateStr

                      return (
                        <button
                          key={dateStr}
                          onClick={(e) => {
                            e.preventDefault()
                            if (visit) setSelectedVisitDate(dateStr)
                          }}
                          className={cn(
                            'min-h-[70px] p-2 border rounded-xl flex flex-col items-center justify-center gap-1.5 transition-colors relative outline-none',
                            !isSelected &&
                              'bg-emerald-50 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:border-emerald-900 cursor-pointer',
                            isSelected &&
                              'bg-primary text-primary-foreground border-primary shadow-sm cursor-pointer'
                          )}
                        >
                          <span className="text-sm font-bold">{format(day, 'd')}</span>
                          {visit && (
                            <div
                              className="flex gap-0.5 mt-auto flex-wrap justify-center px-1"
                              title={visit.stages
                                .map((s) => s.stageType.replace(/_/g, ' '))
                                .join(', ')}
                            >
                              {visit.stages.slice(0, 5).map((s) => (
                                <div
                                  key={s.id}
                                  className={cn(
                                    'h-1.5 w-1.5 rounded-full',
                                    isSelected ? 'bg-primary-foreground' : 'bg-emerald-500'
                                  )}
                                />
                              ))}
                              {visit.stages.length > 5 && (
                                <span
                                  className={cn(
                                    'text-[8px] leading-[6px] ml-0.5',
                                    isSelected ? 'text-primary-foreground' : 'text-emerald-700'
                                  )}
                                >
                                  +
                                </span>
                              )}
                            </div>
                          )}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Right: Selected Visit Details */}
            <div
              className={cn(
                'flex flex-col space-y-4 min-w-0',
                calendarOpen ? 'lg:w-8/12' : 'w-full'
              )}
            >
              {pendingCarryOver && (
                <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-md shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-amber-800 font-medium text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Pending Continuation
                    </h3>
                    <p className="text-amber-700 text-xs mt-1">
                      "{STAGE_META[pendingCarryOver.stageType]?.label}" is waiting to be added to a
                      visit.
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => setPendingCarryOver(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-amber-600 hover:bg-amber-700"
                      onClick={() =>
                        handleDuplicateStage(pendingCarryOver, selectedVisitDate ?? undefined)
                      }
                    >
                      Add to {selectedVisitDate ? formatVisitDate(selectedVisitDate) : 'Visit'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Header is always rendered: it carries the calendar toggle and the
                  single "Add stage" entry point — which a case with no visits yet
                  still needs, since there's no selected group to hang it off. */}
              <div className="flex items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-2 min-w-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setCalendarOpen((prev) => !prev)}
                    aria-label={calendarOpen ? 'Hide visit calendar' : 'Show visit calendar'}
                    title={calendarOpen ? 'Hide calendar' : 'Show calendar'}
                  >
                    {calendarOpen ? (
                      <PanelLeftClose className="h-4 w-4" />
                    ) : (
                      <PanelLeftOpen className="h-4 w-4" />
                    )}
                  </Button>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold tracking-tight">Visit Details</h2>
                    <p className="text-sm text-muted-foreground truncate">
                      {selectedGroup ? formatVisitDate(selectedGroup.key) : 'No visit selected'}
                    </p>
                  </div>
                </div>
                {canEdit && caseData.status === 'open' && (
                  <Button variant="outline" size="sm" className="shrink-0" onClick={openAdd}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add stage
                  </Button>
                )}
              </div>

              {selectedGroup ? (
                <div className="space-y-6">
                  {(() => {
                    const stagesByPlanItem = new Map<string | null, CaseStage[]>()
                    for (const s of selectedGroup.stages) {
                      const pId = s.planItemId ?? null
                      const arr = stagesByPlanItem.get(pId) ?? []
                      arr.push(s)
                      stagesByPlanItem.set(pId, arr)
                    }

                    return Array.from(stagesByPlanItem.entries()).map(
                      ([planItemId, groupStages]) => {
                        const planItem = planItemId
                          ? caseData.planItems?.find((pi) => pi.id === planItemId)
                          : null
                        const title = planItem ? planItem.procedureName : 'Unlinked Stages'

                        return (
                          <div
                            key={planItemId || 'unlinked'}
                            className="bg-slate-50/50 dark:bg-slate-900/20 border rounded-lg p-4 space-y-4"
                          >
                            <h3 className="font-medium text-base text-foreground">{title}</h3>

                            <div className="border-l-2 border-border pl-4 space-y-3 py-1">
                              {groupStages.map((stage) => {
                                const meta = STAGE_META[stage.stageType] ?? {
                                  label: stage.stageType,
                                }
                                const isOpen = expandedIds.has(stage.id)
                                return (
                                  <div
                                    key={stage.id}
                                    className="relative rounded-lg border border-border bg-card shadow-sm overflow-hidden"
                                  >
                                    <div className="absolute -left-[21px] top-4 h-2 w-2 rounded-full bg-border ring-4 ring-background" />
                                    <div
                                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors select-none"
                                      onClick={() => toggleStage(stage.id)}
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <Badge
                                            variant="outline"
                                            className="text-[10px] h-4 px-1.5 shrink-0 text-muted-foreground"
                                          >
                                            {meta.label}
                                          </Badge>
                                          <span className="text-xs text-muted-foreground">
                                            {format(new Date(stage.createdAt), 'h:mm a')}
                                          </span>
                                        </div>
                                        {stage.createdBy && (
                                          <p className="text-xs text-muted-foreground/60 mt-0.5">
                                            by {stage.createdBy.name}
                                          </p>
                                        )}
                                      </div>
                                      <div
                                        className="flex items-center gap-1 shrink-0"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {canEdit && caseData.status === 'open' && (
                                          <>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-7 w-7"
                                              onClick={() => openEdit(stage)}
                                              aria-label="Edit"
                                            >
                                              <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-7 w-7 text-destructive hover:text-destructive"
                                              onClick={() => setDeleteStageId(stage.id)}
                                              aria-label="Delete"
                                            >
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                          </>
                                        )}
                                      </div>
                                      <ChevronDown
                                        className={cn(
                                          'h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200',
                                          isOpen && 'rotate-180'
                                        )}
                                        onClick={() => toggleStage(stage.id)}
                                      />
                                    </div>
                                    {isOpen && (
                                      <div className="border-t border-border flex flex-col">
                                        <div className="px-4 py-4">
                                          <StageDataView stage={stage} />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>

                            {planItem && canEdit && caseData.status === 'open' && (
                              <PlanItemCompletionCard
                                planItem={planItem}
                                answeredNo={answeredNoIds.has(planItem.id)}
                                isSaving={savingPlanItemId === planItem.id}
                                onAnswer={(answer) => handlePlanItemAnswer(planItem.id, answer)}
                                onUndo={() => handlePlanItemUndo(planItem.id)}
                              />
                            )}
                          </div>
                        )
                      }
                    )
                  })()}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-2 rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
                  <CalendarDays className="h-8 w-8 opacity-20 mb-2" />
                  {caseData.stages.length === 0 ? (
                    <>
                      <p>No visits recorded on this case yet</p>
                      <p className="text-sm">
                        {canEdit && caseData.status === 'open'
                          ? 'Use “Add stage” above to start the clinical timeline'
                          : 'Stages added by the clinical team will appear here'}
                      </p>
                    </>
                  ) : (
                    <>
                      <p>Select a highlighted visit date on the calendar</p>
                      <p className="text-sm">to view its details</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add / Edit stage sheet — key resets state when switching between add and different edit targets */}
      {patientId && caseId && (
        <AddStageSheet
          key={sheetStage?.id ?? 'add'}
          caseId={caseId}
          patientId={patientId}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          editStage={sheetStage ?? undefined}
          planItems={caseData.planItems}
          onSuccess={(stage) => {
            setSheetOpen(false)
            if (stage.stageType === 'review') {
              load()
              toast.success('Review saved')
            } else if (sheetStage) {
              setCaseData((prev) =>
                prev
                  ? { ...prev, stages: prev.stages.map((s) => (s.id === stage.id ? stage : s)) }
                  : prev
              )
              // Keep the (possibly re-dated) stage's visit selected and the stage open.
              const key = visitKeyOf(stage)
              setSelectedVisitDate(key)
              setCurrentMonth(parseISO(key))
              setExpandedIds((prev) => new Set(prev).add(stage.id))
              toast.success('Stage updated')
            } else {
              setCaseData((prev) =>
                prev
                  ? {
                      ...prev,
                      stages: [...prev.stages, stage],
                      chiefComplaint:
                        stage.stageType === 'patient_concern'
                          ? (((stage.data as Record<string, unknown>)?.chiefComplaint as
                              | string
                              | null) ?? prev.chiefComplaint)
                          : prev.chiefComplaint,
                    }
                  : prev
              )
              // Reveal the visit the new stage landed in, with the stage expanded.
              const key = visitKeyOf(stage)
              setSelectedVisitDate(key)
              setCurrentMonth(parseISO(key))
              setExpandedIds((prev) => new Set(prev).add(stage.id))
              toast.success('Stage added')
            }
          }}
        />
      )}

      {/* Print sheet */}
      {caseData && (
        <CasePrintSheet
          caseData={caseData}
          patientName={patientName}
          open={printOpen}
          onOpenChange={setPrintOpen}
        />
      )}

      {/* Delete stage confirmation */}
      <DeleteConfirmationDialog
        open={!!deleteStageId}
        onOpenChange={(open) => {
          if (!open) setDeleteStageId(null)
        }}
        onConfirm={handleDeleteStage}
        title="Delete stage"
        description="This will permanently remove this stage from the case."
      />

      {caseData?.plan && (
        <ClinicalTreatmentPlanSheet
          planId={caseData.plan.id}
          patient={{ id: patientId!, name: patientName, patientId: null }}
          open={planSheetOpen}
          onOpenChange={setPlanSheetOpen}
          onPlanUpdated={refreshVisitDetails}
        />
      )}

      {overrideDialog}
    </>
  )
}
