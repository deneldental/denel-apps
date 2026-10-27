import {
  AlertTriangle,
  ClipboardPlus,
  FileText,
  Loader2,
  Receipt,
  RefreshCw,
  Stethoscope,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ClinicalTreatmentPlanSheet } from '@/features/clinical/components/clinical-treatment-plan-sheet'
import { updateAppointment } from '@/lib/actions/appointments'
import { getDoctorWorklist, routeVisit, type WorklistVisit } from '@/lib/actions/worklist'
import { useApiQuery } from '@/lib/query'
import { Button } from '@/shared/components/ui/button'
import { CancelVisitDialog } from './cancel-visit-dialog'
import { CreateEstimateSheet } from './create-estimate-sheet'
import { CreateTreatmentPlanSheet } from './create-treatment-plan-sheet'
import { EstimateBadge, fmtTime, StatusBadge } from './shared'
import { ViewEstimateSheet } from './view-estimate-sheet'

/**
 * Doctor day-sheet lens — the doctor's queue of today's visits. Each visit is
 * actionable: open the patient/case for records, or (awaiting_estimate) create
 * an estimate. The "Create estimate" action is wired in P3.
 */
const doctorWorklistKey = (date: string) => ['activity', 'doctor-worklist', date] as const

export function DoctorLens({ date }: { date: string }) {
  const [estimateFor, setEstimateFor] = useState<WorklistVisit | null>(null)
  const [viewEstimateFor, setViewEstimateFor] = useState<WorklistVisit | null>(null)
  const [createPlanFor, setCreatePlanFor] = useState<WorklistVisit | null>(null)
  const [cancelVisitFor, setCancelVisitFor] = useState<WorklistVisit | null>(null)
  // The plan opens in place (decision D4). It used to link to /clinical/treatment-plans/:id,
  // a route nothing registers, which landed outside the app shell on a bare 404.
  const [viewPlanFor, setViewPlanFor] = useState<WorklistVisit | null>(null)

  const worklistQuery = useApiQuery(doctorWorklistKey(date), () => getDoctorWorklist(date))
  const visits = worklistQuery.data?.visits ?? []
  const unlinked = !!worklistQuery.data?.unlinked
  const loading = worklistQuery.isLoading

  async function skipEstimate(v: WorklistVisit) {
    const res = await routeVisit(v.appointmentId, false)
    if (!res.success) {
      toast.error(res.error || 'Failed to update')
      return
    }
    toast.success('Estimate skipped — reception will bill directly.')
    void worklistQuery.refetch()
  }

  const awaiting = visits.filter((v) => v.estimateStatus === 'awaiting_estimate').length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {loading ? 'Loading…' : `${visits.length} visit${visits.length === 1 ? '' : 's'}`}
          {awaiting > 0 && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              {awaiting} awaiting estimate
            </span>
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void worklistQuery.refetch()}
          disabled={loading}
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : unlinked ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/50 py-12 text-center dark:bg-amber-950/20">
          <AlertTriangle className="h-6 w-6 text-amber-600" />
          <p className="text-sm font-medium">Your account isn't linked to a doctor profile.</p>
          <p className="max-w-md text-xs text-muted-foreground">
            The day-sheet lists the visits booked with you, which needs that link. Ask an
            administrator to connect your user account to your doctor profile.
          </p>
        </div>
      ) : visits.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No visits on the day-sheet.
        </div>
      ) : (
        <div className="space-y-2">
          {visits.map((v) => (
            <div
              key={v.appointmentId}
              className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/patients/${v.patientId}`}
                    className="truncate font-medium hover:underline"
                  >
                    {v.patientName}
                  </Link>
                  <StatusBadge status={v.status} />
                  <EstimateBadge visit={v} />
                  {v.hasPendingNote && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      Note pending
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {fmtTime(v.date)} · {v.type}
                  {v.patientPhone ? ` · ${v.patientPhone}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {v.type !== 'estimate' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCancelVisitFor(v)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                )}
                {/* The doctor owns the estimate: build it, review what was sent,
                    and draft the treatment plan from it. Billing (view invoice,
                    payment plan, confirm & pay) is reception's side and lives on
                    the reception lens — not here.

                    Visits still at estimateStatus null (booked, not yet checked
                    in — badged "Requires estimate") get the create action too:
                    that state previously rendered nothing, leaving no way to begin. */}
                {v.requiresEstimate &&
                  (v.estimateInvoiceId ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setViewEstimateFor(v)}>
                        <Receipt className="mr-1.5 h-3.5 w-3.5" />
                        View estimate
                      </Button>
                      {v.treatmentPlanId ? (
                        <Button size="sm" onClick={() => setViewPlanFor(v)}>
                          <ClipboardPlus className="mr-1.5 h-3.5 w-3.5" />
                          View Treatment Plan
                        </Button>
                      ) : (
                        // A plan may only be built once reception has ISSUED the
                        // estimate — until then nobody has committed the charge,
                        // and the backend refuses it with a 409 anyway. Disabled
                        // rather than hidden so the reason is visible.
                        <Button
                          size="sm"
                          onClick={() => setCreatePlanFor(v)}
                          disabled={v.estimateInvoiceStatus === 'draft'}
                          title={
                            v.estimateInvoiceStatus === 'draft'
                              ? 'Reception must confirm the estimate before a treatment plan can be created'
                              : undefined
                          }
                        >
                          <ClipboardPlus className="mr-1.5 h-3.5 w-3.5" />
                          Create treatment plan
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <Button size="sm" onClick={() => setEstimateFor(v)}>
                        <Stethoscope className="mr-1.5 h-3.5 w-3.5" />
                        Create estimate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        title="Skip the estimate — reception bills directly"
                        onClick={() => skipEstimate(v)}
                      >
                        Skip
                      </Button>
                    </>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {viewEstimateFor?.estimateInvoiceId && (
        <ViewEstimateSheet
          estimateInvoiceId={viewEstimateFor.estimateInvoiceId}
          patientName={viewEstimateFor.patientName}
          open={!!viewEstimateFor}
          onOpenChange={(o) => !o && setViewEstimateFor(null)}
        />
      )}

      {estimateFor && (
        <CreateEstimateSheet
          appointmentId={estimateFor.appointmentId}
          patientName={estimateFor.patientName}
          open={!!estimateFor}
          onOpenChange={(o) => !o && setEstimateFor(null)}
          onCreated={() => {
            setEstimateFor(null)
            void worklistQuery.refetch()
          }}
        />
      )}

      {createPlanFor && (
        <CreateTreatmentPlanSheet
          open={!!createPlanFor}
          onOpenChange={(o) => !o && setCreatePlanFor(null)}
          patientId={createPlanFor.patientId}
          patientName={createPlanFor.patientName}
          estimateInvoiceId={createPlanFor.estimateInvoiceId}
          onCreated={() => {
            setCreatePlanFor(null)
            void worklistQuery.refetch()
          }}
        />
      )}

      {viewPlanFor?.treatmentPlanId && (
        <ClinicalTreatmentPlanSheet
          planId={viewPlanFor.treatmentPlanId}
          patient={{
            id: viewPlanFor.patientId,
            name: viewPlanFor.patientName,
            patientId: null,
          }}
          open
          onOpenChange={(o) => !o && setViewPlanFor(null)}
          onPlanUpdated={() => void worklistQuery.refetch()}
        />
      )}

      {cancelVisitFor && (
        <CancelVisitDialog
          open={!!cancelVisitFor}
          onOpenChange={(open) => !open && setCancelVisitFor(null)}
          patientName={cancelVisitFor.patientName}
          onConfirm={async (reason) => {
            const res = await updateAppointment(
              cancelVisitFor.appointmentId,
              { status: 'cancelled' },
              false,
              reason
            )
            if (res.success) {
              toast.success('Visit cancelled')
              void worklistQuery.refetch()
            } else {
              toast.error(res.error || 'Failed to cancel visit')
            }
          }}
        />
      )}
    </div>
  )
}
