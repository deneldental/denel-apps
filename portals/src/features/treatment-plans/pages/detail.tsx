import { CheckCircle2, FileText, Pencil, Plus, Printer, Share2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useToothNotation } from '@/features/clinical/use-clinical-preferences'
import { api } from '@/lib/api-client'
import { formatCurrency } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

type PlanStatus = 'draft' | 'presented' | 'accepted' | 'in_progress' | 'completed' | 'declined'
type ItemStatus = 'pending' | 'scheduled' | 'completed' | 'cancelled'

type TreatmentPlanItem = {
  id: string
  planId: string
  procedureName: string
  toothNumber: number | null
  phase: number
  estimatedCost: number
  status: ItemStatus
  notes: string | null
  sortOrder: number
}

type TreatmentPlan = {
  id: string
  patientId: string
  title: string
  totalEstimated: number
  status: PlanStatus
  presentedAt: string | null
  acceptedAt: string | null
  declinedAt: string | null
  completedAt: string | null
  signatureData: string | null
  signedByName: string | null
  signedRelationship: string | null
  notes: string | null
  createdById: string | null
  createdAt: string
  updatedAt: string
  items: TreatmentPlanItem[]
}

const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft: 'Draft',
  presented: 'Presented',
  accepted: 'Accepted',
  in_progress: 'In Progress',
  completed: 'Completed',
  declined: 'Declined',
}

const PLAN_STATUS_BADGE: Record<PlanStatus, string> = {
  draft: 'bg-slate-100 text-foreground dark:bg-slate-800 dark:text-slate-300',
  presented: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  declined: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const ITEM_STATUS_BADGE: Record<ItemStatus, string> = {
  pending: 'bg-slate-100 text-foreground dark:bg-slate-800 dark:text-slate-300',
  scheduled: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

function formatLongDate(iso: string): string {
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

export default function TreatmentPlanDetailPage() {
  const { toothLabel } = useToothNotation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [plan, setPlan] = useState<TreatmentPlan | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) {
      navigate('/clinical/treatment-plans', { replace: true })
      return
    }
    void api.get<TreatmentPlan>(`/api/treatment-plans/${id}`).then((res) => {
      setLoading(false)
      if (!res.success || !res.data) {
        navigate('/clinical/treatment-plans', { replace: true })
        return
      }
      setPlan(res.data)
    })
  }, [id, navigate])

  const phases = useMemo(() => {
    if (!plan) return []
    const map = new Map<number, TreatmentPlanItem[]>()
    for (const item of plan.items) {
      const bucket = map.get(item.phase) ?? []
      bucket.push(item)
      map.set(item.phase, bucket)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([phase, items]) => ({ phase, items }))
  }, [plan])

  const completedTotal = useMemo(
    () =>
      plan?.items
        .filter((i) => i.status === 'completed')
        .reduce((s, i) => s + i.estimatedCost, 0) ?? 0,
    [plan]
  )

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading plan…</p>
      </div>
    )
  }

  if (!plan) return null

  function handleAddPhase() {
    toast.info('Add phase — coming soon.')
  }
  function handleAddItem() {
    toast.info('Add item to phase — coming soon.')
  }
  function handleEditPlan() {
    toast.info('Edit plan — coming soon.')
  }
  function handlePrint() {
    toast.info('Print — coming soon.')
  }
  function handleShare() {
    toast.info('Share link (OTP) — coming soon.')
  }
  function handleConvertToPaymentPlan() {
    toast.info('Convert to Payment Plan — coming soon.')
  }
  function handleAttachToRecord() {
    toast.info('Attach to Medical Record — coming soon.')
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{plan.title}</h1>
            <Badge variant="outline" className={PLAN_STATUS_BADGE[plan.status]}>
              {PLAN_STATUS_LABEL[plan.status]}
            </Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>Created {formatLongDate(plan.createdAt)}</span>
            {plan.acceptedAt && (
              <>
                <span className="opacity-50">·</span>
                <span>Accepted {formatLongDate(plan.acceptedAt)}</span>
              </>
            )}
          </div>
        </div>
        <Button variant="outline" onClick={handleEditPlan}>
          <Pencil className="mr-1.5 h-4 w-4" />
          Edit plan
        </Button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Estimated</div>
            <div className="mt-1 text-xl font-semibold">{formatCurrency(plan.totalEstimated)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Completed</div>
            <div className="mt-1 text-xl font-semibold">{formatCurrency(completedTotal)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Remaining</div>
            <div className="mt-1 text-xl font-semibold">
              {formatCurrency(Math.max(0, plan.totalEstimated - completedTotal))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Phases */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Treatment Phases</h2>
          <Button variant="outline" size="sm" onClick={handleAddPhase}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add phase
          </Button>
        </div>

        {phases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No treatment items yet.</p>
        ) : (
          <div className="grid gap-3">
            {phases.map(({ phase, items }) => (
              <Card key={phase}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">Phase {phase}</CardTitle>
                    <span className="text-xs text-muted-foreground">
                      {items.length} item{items.length === 1 ? '' : 's'} ·{' '}
                      {formatCurrency(items.reduce((s, i) => s + i.estimatedCost, 0))}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="divide-y">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{item.procedureName}</div>
                          {item.toothNumber && (
                            <div className="mt-0.5">
                              <Badge
                                variant="outline"
                                className="font-mono text-[10px] px-1.5 py-0"
                              >
                                #{toothLabel(item.toothNumber)}
                              </Badge>
                            </div>
                          )}
                          {item.notes && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{item.notes}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm tabular-nums">
                            {formatCurrency(item.estimatedCost)}
                          </span>
                          <Badge
                            variant="outline"
                            className={ITEM_STATUS_BADGE[item.status as ItemStatus] ?? ''}
                          >
                            {ITEM_STATUS_LABEL[item.status as ItemStatus] ?? item.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={handleAddItem}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add item
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Clinical notes */}
      {plan.notes !== null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Clinical notes</CardTitle>
          </CardHeader>
          <CardContent>
            {plan.notes ? (
              <p className="whitespace-pre-line text-sm text-muted-foreground">{plan.notes}</p>
            ) : (
              <p className="text-sm italic text-muted-foreground">No notes yet.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Patient consent */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Patient consent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input"
              checked={!!plan.acceptedAt}
              readOnly
            />
            <span>I accept this plan and its estimated cost.</span>
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Signature
              </div>
              <div className="flex h-24 w-full items-center justify-center rounded-md border border-dashed bg-muted/30 text-xs text-muted-foreground">
                {plan.signatureData ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Signature on file
                    {plan.signedByName && (
                      <span className="text-muted-foreground">— {plan.signedByName}</span>
                    )}
                  </span>
                ) : (
                  'Signature pad placeholder'
                )}
              </div>
            </div>
            <div className="sm:w-48">
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Date</div>
              <div className="flex h-10 items-center rounded-md border bg-background px-3 text-sm text-muted-foreground">
                {plan.acceptedAt ? formatLongDate(plan.acceptedAt) : '—'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button variant="outline" onClick={handlePrint}>
          <Printer className="mr-1.5 h-4 w-4" />
          Print
        </Button>
        <Button variant="outline" onClick={handleShare}>
          <Share2 className="mr-1.5 h-4 w-4" />
          Share link (OTP)
        </Button>
        <Button variant="outline" onClick={handleConvertToPaymentPlan}>
          <CheckCircle2 className="mr-1.5 h-4 w-4" />
          Convert to Payment Plan
        </Button>
        <Button variant="outline" onClick={handleAttachToRecord}>
          <FileText className="mr-1.5 h-4 w-4" />
          Attach to Medical Record
        </Button>
      </div>
    </div>
  )
}
