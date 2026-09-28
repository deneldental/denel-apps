import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ReceivePaymentDialog } from '@/features/payments/components/receive-payment-dialog'
import { getPatient } from '@/lib/actions/patients'
import { getPaymentPlanByPatientId } from '@/lib/actions/payment-plans'
import type { patients, paymentPlans } from '@/lib/db/schema'
import { useApiQuery } from '@/lib/query'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PatientPicker, type PickerPatient } from '@/shared/components/patient-picker'
import { Button } from '@/shared/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'

type Patient = typeof patients.$inferSelect
type PaymentPlan = typeof paymentPlans.$inferSelect

interface PlanPaymentSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  /**
   * Locks the payment to this patient — the picker stage is skipped and the
   * plan-receive dialog opens directly. Only pass this when the caller
   * genuinely knows the patient (e.g. appointment check-in).
   */
  presetPatientId?: string
  /**
   * Returns to the previous step of a multi-step flow (the payment-type card
   * grid) instead of closing the sheet outright. Only used at the
   * patient-picker stage — once the receive-payment dialog is open, closing
   * it closes the whole flow, matching how that dialog behaves everywhere
   * else it's used.
   */
  onBack?: () => void
}

/**
 * Plan-payment entry point. A payment plan can have several open invoices
 * (installments) and a payment can be split across several sources (wallet +
 * cash, etc.) — so once a patient's plan is known, this hands off entirely to
 * <ReceivePaymentDialog> (the same multi-invoice / multi-source flow used
 * from the patient ledger's Payment Plans tab) rather than re-implementing a
 * single-amount/single-method form here.
 */
export function PlanPaymentSheet({
  open,
  onOpenChange,
  onSuccess,
  presetPatientId,
  onBack,
}: PlanPaymentSheetProps) {
  const [patientId, setPatientId] = useState(presetPatientId ?? '')
  // Tracked from <PatientPicker>'s onChange (its second arg) rather than
  // looked up in a bulk-fetched list — the picker searches the server now.
  const [pickedPatient, setPickedPatient] = useState<PickerPatient | null>(null)

  useEffect(() => {
    if (!open) return
    setPatientId(presetPatientId ?? '')
    setPickedPatient(null)
  }, [open, presetPatientId])

  // presetPatientId skips the picker, so the patient's name (for the dialog
  // title) comes from a direct lookup instead of the full list above.
  const presetPatientQuery = useApiQuery<Patient | null>(
    ['patients', 'byId', presetPatientId ?? 'none'] as const,
    async () => {
      if (!presetPatientId) return { success: true, data: null }
      const res = await getPatient(presetPatientId)
      return { success: res.success, data: res.data ?? null }
    },
    { enabled: open && !!presetPatientId }
  )

  const selectedPatient = presetPatientId ? (presetPatientQuery.data ?? null) : pickedPatient

  // getPaymentPlanByPatientId returns every plan for the patient (array, not
  // single) — take the most recent active one, matching the backend's
  // `orderBy: desc(createdAt)` + default archived=false filter.
  const planQuery = useApiQuery<PaymentPlan | null>(
    ['payment-plans', 'patient', patientId || 'none', 'active-one'] as const,
    async () => {
      const res = await getPaymentPlanByPatientId(patientId)
      if (!res.success || !res.data?.length) return { success: true, data: null }
      return { success: true, data: res.data[0] }
    },
    { enabled: !!patientId }
  )
  const plan = planQuery.data ?? null
  const resolvingPlan = !!patientId && planQuery.isLoading

  const isDirty = !presetPatientId && !!patientId
  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  // Patient (and plan) resolved — hand off to the real payment form.
  if (patientId && plan) {
    return (
      <ReceivePaymentDialog
        open={open}
        onOpenChange={onOpenChange}
        patientId={patientId}
        patientName={selectedPatient?.name}
        planId={plan.id}
        onPosted={onSuccess}
      />
    )
  }

  return (
    <>
      <Sheet open={open} onOpenChange={guardedOnOpenChange}>
        <SheetContent className="!w-full !max-w-[480px] overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle>Payment Plan Payment</SheetTitle>
            <SheetDescription>Select a patient to receive their plan payment.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="plan-payment-patient">
                Select Patient *
              </label>
              <PatientPicker
                id="plan-payment-patient"
                value={patientId}
                onChange={(id, patient) => {
                  setPatientId(id)
                  setPickedPatient(patient)
                }}
                placeholder="Select a patient"
                popoverWidthClass="w-[400px]"
              />
            </div>

            {patientId && resolvingPlan && (
              <p className="text-sm text-muted-foreground">Checking for an active plan…</p>
            )}
            {patientId && !resolvingPlan && !plan && (
              <div className="rounded-lg border p-4 bg-yellow-50 dark:bg-yellow-900/20">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  This patient does not have an active payment plan.
                </p>
              </div>
            )}
          </div>
          <SheetFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (onBack) onBack()
                else onOpenChange(false)
              }}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
