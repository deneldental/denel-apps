import { CircleDollarSign, Loader2, RefreshCw, Stethoscope, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { PaymentPlanSheet } from '@/features/payment-plans/components/payment-plan-sheet'
import { InvoiceViewSheet } from '@/features/payments/components/invoice-view-sheet'
import { updateAppointment } from '@/lib/actions/appointments'
import {
  cancelEstimate,
  getReceptionWorklist,
  routeVisit,
  type WorklistVisit,
} from '@/lib/actions/worklist'
import { useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { CancelVisitDialog } from './cancel-visit-dialog'
import { ConfirmEstimateSheet } from './confirm-estimate-sheet'
import { EstimateBadge, fmtTime, ghs, StatusBadge } from './shared'

/**
 * Reception billing lens — the same day's visits, seen for billing. Visits with
 * a ready estimate can be Confirmed & paid; checked-in direct-bill visits can be
 * charged. The Confirm/Cancel actions are wired in P4.
 */
const receptionWorklistKey = (date: string) => ['activity', 'reception-worklist', date] as const

export function ReceptionLens({ date }: { date: string }) {
  const [confirmFor, setConfirmFor] = useState<WorklistVisit | null>(null)
  const [planFor, setPlanFor] = useState<WorklistVisit | null>(null)
  const [viewInvoiceFor, setViewInvoiceFor] = useState<WorklistVisit | null>(null)
  const [cancelVisitFor, setCancelVisitFor] = useState<WorklistVisit | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const worklistQuery = useApiQuery(receptionWorklistKey(date), () => getReceptionWorklist(date))
  const visits = worklistQuery.data?.visits ?? []
  const loading = worklistQuery.isLoading

  // Removed handleCancelVisit to use CancelVisitDialog directly
  async function handleCancel(v: WorklistVisit) {
    setCancelling(v.appointmentId)
    const res = await cancelEstimate(v.appointmentId)
    setCancelling(null)
    if (!res.success) {
      toast.error(res.error || 'Failed to cancel')
      return
    }
    toast.success('Estimate cancelled — back to the doctor.')
    void worklistQuery.refetch()
  }

  async function sendToDoctor(v: WorklistVisit) {
    const res = await routeVisit(v.appointmentId, true)
    if (!res.success) {
      toast.error(res.error || 'Failed to route')
      return
    }
    toast.success('Sent to the doctor for an estimate.')
    void worklistQuery.refetch()
  }

  const ready = visits.filter((v) => v.estimateStatus === 'estimate_ready').length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {loading ? 'Loading…' : `${visits.length} visit${visits.length === 1 ? '' : 's'}`}
          {ready > 0 && (
            <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">
              {ready} estimate{ready === 1 ? '' : 's'} ready
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
      ) : visits.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No visits for this day.
        </div>
      ) : (
        <div className="space-y-2">
          {visits
            .filter((v) => v.estimateInvoiceStatus !== 'paid')
            .map((v) => {
              const estimateReady = v.estimateStatus === 'estimate_ready'
              // Server-decided (see WorklistVisit.treatmentBlocked). A client-side
              // approximation would badge plan-covered and insured visits wrongly.
              const treatmentBlocked = v.treatmentBlocked === true
              return (
                <div
                  key={v.appointmentId}
                  className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/patients/${v.patientId}`}
                        className="truncate font-medium hover:underline"
                      >
                        {v.patientName}
                      </Link>
                      <StatusBadge status={v.status} />
                      <EstimateBadge visit={v} />
                      {treatmentBlocked && (
                        <Badge
                          variant="outline"
                          className="border-amber-300 bg-amber-50 text-amber-800"
                          title={
                            v.treatmentBlockedReason ??
                            'Treatment cannot start until a payment or payment plan is recorded'
                          }
                        >
                          Treatment blocked — unpaid
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {fmtTime(v.date)} · {v.type}
                      {v.doctorName ? ` · Dr. ${v.doctorName}` : ''}
                      {v.estimateTotal != null ? ` · ${ghs(v.estimateTotal)}` : ''}
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
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Cancel Visit
                      </Button>
                    )}
                    {/* Needs estimate - Removed Cancel estimate button to avoid duplicate cancel buttons */}

                    {/* Estimate ready */}
                    {estimateReady && (
                      <>
                        {v.estimateInvoiceId && (
                          <Button variant="outline" size="sm" onClick={() => setViewInvoiceFor(v)}>
                            <CircleDollarSign className="mr-1.5 h-3.5 w-3.5" />
                            View invoice
                          </Button>
                        )}
                        <Button size="sm" onClick={() => setConfirmFor(v)}>
                          <CircleDollarSign className="mr-1.5 h-3.5 w-3.5" />
                          Confirm &amp; pay
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={cancelling === v.appointmentId}
                          onClick={() => handleCancel(v)}
                        >
                          {cancelling === v.appointmentId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <X className="mr-1.5 h-3.5 w-3.5" />
                              Cancel Estimate
                            </>
                          )}
                        </Button>
                      </>
                    )}

                    {/* Direct bill or invoiced visits */}
                    {v.estimateStatus !== 'awaiting_estimate' && !estimateReady && (
                      <>
                        {v.estimateStatus === 'invoiced' && v.estimateInvoiceStatus !== 'paid' && (
                          <>
                            {v.estimateInvoiceId && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setViewInvoiceFor(v)}
                              >
                                <CircleDollarSign className="mr-1.5 h-3.5 w-3.5" />
                                View invoice
                              </Button>
                            )}
                            <Button size="sm" onClick={() => setConfirmFor(v)}>
                              <CircleDollarSign className="mr-1.5 h-3.5 w-3.5" />
                              Collect Payment
                            </Button>
                          </>
                        )}
                        {(v.status === 'checked_in' || v.status === 'in_chair') && (
                          <>
                            <Button asChild variant="outline" size="sm">
                              <Link to={`/patients/${v.patientId}?tab=ledger`}>
                                <CircleDollarSign className="mr-1.5 h-3.5 w-3.5" />
                                View Ledger
                              </Link>
                            </Button>
                            {!v.requiresEstimate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Send to doctor for an estimate"
                                onClick={() => sendToDoctor(v)}
                              >
                                <Stethoscope className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {planFor && (
        <PaymentPlanSheet
          patientId={planFor.patientId}
          sourceInvoiceId={planFor.estimateInvoiceId}
          open={!!planFor}
          onOpenChange={(o) => !o && setPlanFor(null)}
          onSuccess={() => {
            setPlanFor(null)
            void worklistQuery.refetch()
          }}
        />
      )}

      {viewInvoiceFor && (
        <InvoiceViewSheet
          open={!!viewInvoiceFor}
          onOpenChange={(o) => !o && setViewInvoiceFor(null)}
          invoiceId={viewInvoiceFor.estimateInvoiceId}
          patientName={viewInvoiceFor.patientName}
        />
      )}

      {confirmFor && (
        <ConfirmEstimateSheet
          appointmentId={confirmFor.appointmentId}
          patientId={confirmFor.patientId}
          patientName={confirmFor.patientName}
          estimateTotal={confirmFor.estimateTotal ?? 0}
          estimateInvoiceId={confirmFor.estimateInvoiceId}
          open={!!confirmFor}
          onOpenChange={(o) => !o && setConfirmFor(null)}
          onConfirmed={() => {
            setConfirmFor(null)
            void worklistQuery.refetch()
          }}
          onCreatePlan={() => {
            const currentVisit = confirmFor
            setConfirmFor(null)
            setPlanFor(currentVisit)
          }}
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
