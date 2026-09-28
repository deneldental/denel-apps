import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Activity,
  ChevronRight,
  Lock,
  MoreHorizontal,
  Plus,
  ShieldAlert,
  Trash2,
  Unlock,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { isOrthoPatient } from '@/lib/actions/patient-tags'
import { api } from '@/lib/api-client'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/shared/components/ui/accordion'
import { AdminPasswordDialog } from '@/shared/components/ui/admin-password-dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/components/ui/sheet'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { usePermissions } from '@/shared/hooks/use-permissions'
import { AddStageSheet } from './add-stage-sheet'
import { StageDetailSheet } from './stage-detail-sheet'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CaseStage = {
  id: string
  caseId: string
  stageType: string
  data: Record<string, unknown>
  status?: string
  /** Calendar day (YYYY-MM-DD) of the visit this stage belongs to. */
  visitDate?: string | null
  planItemId?: string | null
  createdAt: string
  createdBy: { id: string; name: string } | null
}

type FullCase = {
  id: string
  caseNumber: string
  status: 'open' | 'closed'
  chiefComplaint: string | null
  createdAt: string
  createdBy: { id: string; name: string } | null
  stages: CaseStage[]
}

// ─── Stage labels ─────────────────────────────────────────────────────────────

const STAGE_META: Record<string, { label: string }> = {
  // v1 legacy
  patient_concern: { label: 'Patient Concern' },
  oral_health: { label: 'Oral Health' },
  // v2
  presenting_complaint: { label: 'Presenting Complaint' },
  history_of_presenting_complaint: { label: 'History of Presenting Complaints' },
  past_medical_surgical_history: { label: 'Past Medical & Surgical History' },
  drug_history_allergies: { label: 'Drug History & Allergies' },
  social_history: { label: 'Social History' },
  // §2.3 — examination before diagnosis (examine, then diagnose)
  examination: { label: 'Examination' },
  diagnosis: { label: 'Diagnosis' },
  treatment_plan: { label: 'Treatment Plan' },
  prescription: { label: 'Prescription' },
  // §2.5 — merged Review stage (reuse fuchsia); legacy entries kept readable
  review: { label: 'Review' },
  dental_review: { label: 'Dental Review' },
  ortho_review: { label: 'Ortho Review' },
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  caseId: string
  patientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  canEdit?: boolean
  patientName?: string
}

export function CaseDetailSheet({
  caseId,
  patientId,
  open,
  onOpenChange,
  canEdit = true,
  patientName,
}: Props) {
  const [addStageOpen, setAddStageOpen] = useState(false)
  const [selectedStage, setSelectedStage] = useState<CaseStage | null>(null)
  const [stageDetailOpen, setStageDetailOpen] = useState(false)
  const [deleteStageId, setDeleteStageId] = useState<string | null>(null)
  const [purgeStage, setPurgeStage] = useState<CaseStage | null>(null)
  const { isAdmin } = usePermissions()
  const queryClient = useQueryClient()

  const CASE_KEY = queryKeys.patientCases.detail(caseId)
  const caseQuery = useApiQuery<FullCase>(
    CASE_KEY,
    () => api.get<FullCase>(`/api/patient-cases/${caseId}`),
    { enabled: open }
  )
  const caseData = caseQuery.data ?? null
  const loading = caseQuery.isLoading

  // §2.7 — "Ortho" is now a tag, not a column. Gate ortho-only stages on it.
  const orthoPatientQuery = useApiQuery(
    queryKeys.patients.detail(patientId),
    () => api.get<{ tags?: Array<{ name: string }> }>(`/api/patients/${patientId}`),
    { enabled: open }
  )
  const isOrtho = orthoPatientQuery.data ? isOrthoPatient(orthoPatientQuery.data.tags) : false

  const toggleStatusMutation = useApiMutation(
    (newStatus: 'open' | 'closed') =>
      api.patch(`/api/patient-cases/${caseId}`, { status: newStatus }),
    {
      onSuccess: (_data, newStatus) => {
        queryClient.setQueryData<FullCase | undefined>(CASE_KEY, (prev) =>
          prev ? { ...prev, status: newStatus } : prev
        )
      },
    }
  )
  const togglingStatus = toggleStatusMutation.isPending

  const softDeleteStageMutation = useApiMutation(
    (stageId: string) => api.delete(`/api/patient-cases/${caseId}/stages/${stageId}`),
    {
      onSuccess: (_data, stageId) => {
        queryClient.setQueryData<FullCase | undefined>(CASE_KEY, (prev) =>
          prev ? { ...prev, stages: prev.stages.filter((s) => s.id !== stageId) } : prev
        )
      },
    }
  )

  const purgeStageMutation = useApiMutation(
    async (vars: { stageId: string; password: string }) => {
      const res = await api.post(`/api/patient-cases/${caseId}/stages/${vars.stageId}/permanent`, {
        password: vars.password,
      })
      if (!res.success) throw new Error((res.error as string) ?? 'Verification failed')
      return res
    },
    {
      onSuccess: (_data, vars) => {
        queryClient.setQueryData<FullCase | undefined>(CASE_KEY, (prev) =>
          prev ? { ...prev, stages: prev.stages.filter((s) => s.id !== vars.stageId) } : prev
        )
      },
    }
  )

  async function handleToggleStatus() {
    if (!caseData) return
    const newStatus = caseData.status === 'open' ? 'closed' : 'open'
    try {
      await toggleStatusMutation.mutateAsync(newStatus)
      toast.success(newStatus === 'closed' ? 'Case closed' : 'Case reopened')
    } catch {
      toast.error('Failed to update case status')
    }
  }

  async function handleSoftDeleteStage() {
    if (!deleteStageId) return
    try {
      await softDeleteStageMutation.mutateAsync(deleteStageId)
      toast.success('Stage removed')
    } catch {
      toast.error('Failed to delete stage')
    }
    setDeleteStageId(null)
  }

  async function handlePermanentDeleteStage(password: string) {
    if (!purgeStage) throw new Error('No stage selected')
    await purgeStageMutation.mutateAsync({ stageId: purgeStage.id, password })
    toast.success('Stage permanently deleted')
    setPurgeStage(null)
  }

  const groupedStages = (caseData?.stages || []).reduce<Record<string, CaseStage[]>>(
    (acc, stage) => {
      const d = stage.visitDate || new Date(stage.createdAt).toISOString().slice(0, 10)
      if (!acc[d]) acc[d] = []
      acc[d].push(stage)
      return acc
    },
    {}
  )

  const sortedVisitDates = Object.keys(groupedStages).sort((a, b) => b.localeCompare(a))
  for (const date of sortedVisitDates) {
    groupedStages[date].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
  }
  const defaultExpanded = sortedVisitDates.length > 0 ? [sortedVisitDates[0]] : []

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {loading || !caseData ? (
            <div className="space-y-4 pt-6">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-2/3" />
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              <SheetHeader className="pb-4 border-b">
                {patientName && (
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                    {patientName}
                  </p>
                )}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <SheetTitle className="font-mono text-base">{caseData.caseNumber}</SheetTitle>
                    {caseData.chiefComplaint && (
                      <p className="text-sm text-muted-foreground mt-1 leading-snug">
                        {caseData.chiefComplaint}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
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
                    {canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleToggleStatus}
                        disabled={togglingStatus}
                      >
                        {caseData.status === 'open' ? (
                          <>
                            <Lock className="h-3 w-3 mr-1" />
                            Close
                          </>
                        ) : (
                          <>
                            <Unlock className="h-3 w-3 mr-1" />
                            Reopen
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Created {format(new Date(caseData.createdAt), 'MMM d, yyyy')}
                  {caseData.createdBy ? ` by ${caseData.createdBy.name}` : ''}
                </p>
              </SheetHeader>

              <div className="pt-4 space-y-3">
                {canEdit && caseData.status === 'open' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setAddStageOpen(true)}
                  >
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add stage
                  </Button>
                )}

                {caseData.stages.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
                    <Activity className="h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No stages recorded yet.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Accordion
                      type="multiple"
                      defaultValue={defaultExpanded}
                      className="w-full space-y-3"
                    >
                      {sortedVisitDates.map((visitDateStr) => {
                        const visitStages = groupedStages[visitDateStr]
                        return (
                          <AccordionItem
                            key={visitDateStr}
                            value={visitDateStr}
                            className="border rounded-lg bg-card px-4 shadow-sm"
                          >
                            <AccordionTrigger className="hover:no-underline py-3">
                              <div className="flex flex-1 items-center gap-3 pr-4">
                                <span className="text-sm font-semibold">
                                  {format(new Date(visitDateStr), 'MMM d, yyyy')}
                                </span>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs text-muted-foreground mr-1">
                                    {visitStages.length} stage{visitStages.length !== 1 ? 's' : ''}
                                  </span>
                                  {visitStages.map((stage) => {
                                    const meta = STAGE_META[stage.stageType] ?? {
                                      label: stage.stageType,
                                      color: 'bg-muted text-muted-foreground',
                                    }
                                    return (
                                      <Badge
                                        key={stage.id}
                                        variant="outline"
                                        className="text-[10px] h-5 px-1.5 bg-muted/50 text-muted-foreground border-border"
                                      >
                                        {meta.label}
                                      </Badge>
                                    )
                                  })}
                                </div>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="pt-2 pb-4 space-y-2">
                              {visitStages.map((stage) => {
                                const meta = STAGE_META[stage.stageType] ?? {
                                  label: stage.stageType,
                                }
                                return (
                                  <div
                                    key={stage.id}
                                    className={`flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 group`}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <Badge
                                          variant="outline"
                                          className="text-[10px] h-4 px-1.5 text-muted-foreground"
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
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => {
                                          setSelectedStage(stage)
                                          setStageDetailOpen(true)
                                        }}
                                        aria-label="Next"
                                      >
                                        <ChevronRight className="h-4 w-4" />
                                      </Button>
                                      {canEdit && caseData.status === 'open' && (
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-7 w-7 opacity-0 group-hover:opacity-100"
                                              aria-label="More options"
                                            >
                                              <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            <DropdownMenuItem
                                              onSelect={() => {
                                                setSelectedStage(stage)
                                                setStageDetailOpen(true)
                                              }}
                                            >
                                              View details
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                              className="text-destructive focus:text-destructive"
                                              onSelect={() => setDeleteStageId(stage.id)}
                                            >
                                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                                              Delete stage
                                            </DropdownMenuItem>
                                            {isAdmin && (
                                              <DropdownMenuItem
                                                className="text-destructive focus:text-destructive"
                                                onSelect={() => setPurgeStage(stage)}
                                              >
                                                <ShieldAlert className="h-3.5 w-3.5 mr-2" />
                                                Permanently delete…
                                              </DropdownMenuItem>
                                            )}
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </AccordionContent>
                          </AccordionItem>
                        )
                      })}
                    </Accordion>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {addStageOpen && (
        <AddStageSheet
          caseId={caseId}
          patientId={patientId}
          isOrtho={isOrtho}
          open={addStageOpen}
          onOpenChange={setAddStageOpen}
          onSuccess={(stage) => {
            setAddStageOpen(false)
            if (stage.stageType === 'review') {
              // Review may have changed stage statuses — reload the full case
              queryClient.invalidateQueries({ queryKey: CASE_KEY })
              toast.success('Review saved')
            } else {
              queryClient.setQueryData<FullCase | undefined>(CASE_KEY, (prev) =>
                prev
                  ? {
                      ...prev,
                      stages: [...prev.stages, stage],
                      chiefComplaint:
                        stage.stageType === 'patient_concern'
                          ? ((stage.data as any)?.chiefComplaint ?? prev.chiefComplaint)
                          : stage.stageType === 'presenting_complaint'
                            ? ((stage.data as any)?.items ?? [])
                                .map((i: any) => i.displayName ?? i.name)
                                .filter(Boolean)
                                .join(', ') || prev.chiefComplaint
                            : prev.chiefComplaint,
                    }
                  : prev
              )
              toast.success('Stage added')
            }
          }}
        />
      )}

      {selectedStage && (
        <StageDetailSheet
          stage={selectedStage}
          open={stageDetailOpen}
          onOpenChange={setStageDetailOpen}
          canEdit={canEdit && caseData?.status === 'open'}
          onUpdated={(updated) => {
            queryClient.setQueryData<FullCase | undefined>(CASE_KEY, (prev) =>
              prev
                ? { ...prev, stages: prev.stages.map((s) => (s.id === updated.id ? updated : s)) }
                : prev
            )
          }}
        />
      )}

      <DeleteConfirmationDialog
        open={!!deleteStageId}
        onOpenChange={(open) => {
          if (!open) setDeleteStageId(null)
        }}
        onConfirm={handleSoftDeleteStage}
        title="Delete stage"
        description="The stage is hidden from the case timeline but kept for audit. An admin can permanently remove it."
      />

      <AdminPasswordDialog
        open={!!purgeStage}
        onOpenChange={(open) => {
          if (!open) setPurgeStage(null)
        }}
        onConfirm={handlePermanentDeleteStage}
        title="Permanently delete stage"
        description="This removes the stage forever and cannot be undone."
        itemName={
          purgeStage ? (STAGE_META[purgeStage.stageType]?.label ?? purgeStage.stageType) : ''
        }
      />
    </>
  )
}
