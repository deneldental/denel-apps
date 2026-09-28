import { format } from 'date-fns'
import { CheckCircle2, Eye, FileText, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useToothNotation } from '@/features/clinical/use-clinical-preferences'
import { api } from '@/lib/api-client'
import { PermissionGuard } from '@/shared/components/permission-guard'
import { SensitiveActionDialog } from '@/shared/components/sensitive-action-dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { formatAmount } from '@/shared/utils/currency'
import { STATUS_LABELS, STATUS_VARIANT, type TreatmentPlan } from '../types'
import { TreatmentPlanEditor } from './treatment-plan-editor'
import { TreatmentPlanPresentDialog } from './treatment-plan-present-dialog'

interface Props {
  patientId: string
  canEdit?: boolean
}

export function TreatmentPlansTab({ patientId, canEdit = true }: Props) {
  const { toothLabel } = useToothNotation()
  const [plans, setPlans] = useState<TreatmentPlan[]>([])
  const [loading, setLoading] = useState(true)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<TreatmentPlan | null>(null)

  const [presentPlan, setPresentPlan] = useState<TreatmentPlan | null>(null)

  const [deletingPlan, setDeletingPlan] = useState<TreatmentPlan | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<TreatmentPlan[]>(`/api/treatment-plans/patient/${patientId}`)
    if (res.success && res.data) setPlans(res.data)
    setLoading(false)
  }, [patientId])

  useEffect(() => {
    load()
  }, [load])

  function openCreate() {
    setEditingPlan(null)
    setEditorOpen(true)
  }
  function openEdit(plan: TreatmentPlan) {
    setEditingPlan(plan)
    setEditorOpen(true)
  }
  function openPresent(plan: TreatmentPlan) {
    setPresentPlan(plan)
  }
  async function markPresented(plan: TreatmentPlan) {
    const res = await api.patch(`/api/treatment-plans/${plan.id}`, { status: 'presented' })
    if (res.success) {
      toast.success('Plan marked as presented')
      load()
    }
  }
  async function markInProgress(plan: TreatmentPlan) {
    const res = await api.patch(`/api/treatment-plans/${plan.id}`, { status: 'in_progress' })
    if (res.success) {
      toast.success('Marked as in progress')
      load()
    }
  }
  async function markCompleted(plan: TreatmentPlan) {
    const res = await api.patch(`/api/treatment-plans/${plan.id}`, { status: 'completed' })
    if (res.success) {
      toast.success('Marked as completed')
      load()
    }
  }
  function openDeleteDialog(plan: TreatmentPlan) {
    setDeletingPlan(plan)
  }
  async function confirmDelete({ reason }: { reason: string }) {
    if (!deletingPlan) return
    const res = await api.delete(
      `/api/treatment-plans/${deletingPlan.id}?reason=${encodeURIComponent(reason)}`
    )
    if (res.success) {
      toast.success('Plan deleted')
      setDeletingPlan(null)
      load()
    } else {
      toast.error((res.error as string) || 'Failed to delete')
      throw new Error('Delete failed')
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Treatment Plans</h3>
          <p className="text-xs text-muted-foreground">
            Phased procedure plans with patient acceptance.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Plan
          </Button>
        )}
      </div>

      {plans.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
          <FileText className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No treatment plans yet.</p>
          {canEdit && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create First Plan
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {plans.map((plan) => (
            <div key={plan.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-sm truncate">{plan.title}</h4>
                    <Badge variant={STATUS_VARIANT[plan.status]} className="text-[10px] capitalize">
                      {STATUS_LABELS[plan.status]}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {plan.items.length} procedure(s) · Created {(() => {
                      try {
                        return format(new Date(plan.createdAt), 'MMM d, yyyy')
                      } catch {
                        return plan.createdAt
                      }
                    })()}
                    {plan.acceptedAt && (
                      <>
                        {' · Accepted '}
                        {(() => {
                          try {
                            return format(new Date(plan.acceptedAt), 'MMM d, yyyy')
                          } catch {
                            return plan.acceptedAt
                          }
                        })()}
                        {plan.signedByName && ` by ${plan.signedByName}`}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-lg font-bold">
                    GHS {formatAmount(Number(plan.totalEstimated))}
                  </span>
                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label="More options"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openPresent(plan)}>
                          <Eye className="mr-2 h-4 w-4" />
                          {plan.status === 'accepted' ? 'View Signed' : 'Present & Sign'}
                        </DropdownMenuItem>
                        {plan.status === 'draft' && (
                          <DropdownMenuItem onClick={() => markPresented(plan)}>
                            Mark as Presented
                          </DropdownMenuItem>
                        )}
                        {plan.status === 'accepted' && (
                          <DropdownMenuItem onClick={() => markInProgress(plan)}>
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            Start Progress
                          </DropdownMenuItem>
                        )}
                        {plan.status === 'in_progress' && (
                          <DropdownMenuItem onClick={() => markCompleted(plan)}>
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            Mark Completed
                          </DropdownMenuItem>
                        )}
                        {(plan.status === 'draft' || plan.status === 'presented') && (
                          <DropdownMenuItem onClick={() => openEdit(plan)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        <PermissionGuard module="medical_records" action="delete">
                          <DropdownMenuItem
                            onClick={() => openDeleteDialog(plan)}
                            className="text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </PermissionGuard>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>

              {/* Items preview */}
              <div className="space-y-1 text-xs">
                {plan.items.slice(0, 4).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 text-muted-foreground"
                  >
                    <span className="truncate">
                      <span className="font-mono text-[10px] mr-1.5 opacity-70">P{item.phase}</span>
                      {item.procedureName}
                      {item.toothNumber != null && (
                        <span className="font-mono opacity-70 ml-1">
                          #{toothLabel(item.toothNumber)}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0">GHS {formatAmount(Number(item.estimatedCost))}</span>
                  </div>
                ))}
                {plan.items.length > 4 && (
                  <p className="text-[10px] text-muted-foreground/70 italic">
                    + {plan.items.length - 4} more procedure(s)
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor dialog */}
      <Dialog open={editorOpen} onOpenChange={(o) => !o && setEditorOpen(false)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPlan ? `Edit: ${editingPlan.title}` : 'New Treatment Plan'}
            </DialogTitle>
          </DialogHeader>
          <TreatmentPlanEditor
            patientId={patientId}
            plan={editingPlan}
            onClose={() => setEditorOpen(false)}
            onSaved={() => {
              setEditorOpen(false)
              load()
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Present & Sign dialog */}
      {presentPlan && (
        <TreatmentPlanPresentDialog
          plan={presentPlan}
          open={true}
          onClose={() => setPresentPlan(null)}
          onAccepted={() => {
            setPresentPlan(null)
            load()
          }}
        />
      )}

      {/* Sensitive-action delete dialog — captures audit reason */}
      <SensitiveActionDialog
        open={!!deletingPlan}
        onOpenChange={(o) => !o && setDeletingPlan(null)}
        title="Delete Treatment Plan"
        description={
          deletingPlan
            ? `Permanently delete "${deletingPlan.title}"? All phases and signatures will be removed. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete Plan"
        onConfirm={confirmDelete}
      />
    </div>
  )
}
