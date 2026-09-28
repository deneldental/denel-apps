import { ArrowLeft, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { isOrthoPatient } from '@/lib/actions/patient-tags'
import { getPaymentPlanByPatientId } from '@/lib/actions/payment-plans'
import { createPayment, getPaymentsByPatientId } from '@/lib/actions/payments'
import { getTreatmentTypes } from '@/lib/actions/treatment-types'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PaymentMethodSelect } from '@/shared/components/payment-method-select'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { TreatmentTypesMultiSelect } from '@/shared/components/ui/treatment-types-multiselect'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { usePaymentMethods } from '@/shared/hooks/use-payment-methods'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { formatAmount } from '@/shared/utils/currency'
import { generatePaymentReceipt } from '@/shared/utils/receipt'
import { CheckInPaymentCardGrid, type CheckInPaymentType } from './check-in-payment-card-grid'

interface Appointment {
  id: string
  patientId: string
  doctorId: string
  date: Date | string
  type?: string
  notes?: string | null
  patient?: {
    name: string
    // §2.7 — "Ortho" is a tag now; the ortho payment-plan gate reads tags.
    tags?: Array<{ name: string }>
  }
  [key: string]: unknown
}

interface CheckInPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: Appointment | null
  onSuccess?: () => void
}

export function CheckInPaymentDialog({
  open,
  onOpenChange,
  appointment,
  onSuccess,
}: CheckInPaymentDialogProps) {
  const { isSubmitting, submit } = useSubmitGuard()
  const [paymentType, setPaymentType] = useState<CheckInPaymentType | null>(null)
  interface TreatmentType {
    id: string
    name: string
    displayName?: string | null
  }
  interface PaymentPlan {
    id: string
    totalAmount?: number
    totalAmountCents?: number
    [key: string]: unknown
  }
  const [selectedTreatmentTypes, setSelectedTreatmentTypes] = useState<string[]>([])

  const [formData, setFormData] = useState({
    amount: '',
    method: '',
    description: '',
    sendNotification: true,
  })

  // §2.7 — "Ortho" is a tag; the payment-plan card is gated on it.
  const isOrtho = isOrthoPatient(appointment?.patient?.tags)

  const patientId = appointment?.patientId

  const paymentPlanQuery = useApiQuery<{ plan: PaymentPlan; outstandingBalance: number } | null>(
    queryKeys.paymentPlans.patient(patientId ?? ''),
    async () => {
      const [planResult, paymentsResult] = await Promise.all([
        getPaymentPlanByPatientId(patientId as string),
        getPaymentsByPatientId(patientId as string),
      ])
      // getPaymentPlanByPatientId returns every plan for the patient (array,
      // not single) — take the most recent active one, matching the backend's
      // `orderBy: desc(createdAt)` + default archived=false filter.
      if (!planResult.success || !planResult.data?.length) return { success: true, data: null }
      const plan = planResult.data[0]
      // Calculate outstanding balance
      const totalPaid =
        paymentsResult.success && paymentsResult.data
          ? paymentsResult.data
              .filter(
                (p) =>
                  (p.status === 'posted' || p.status === 'completed') && p.paymentPlanId === plan.id
              )
              .reduce((sum, p) => sum + (p.amount || 0), 0)
          : 0
      return {
        success: true,
        data: { plan, outstandingBalance: Math.max(0, (plan.totalAmount || 0) - totalPaid) },
      }
    },
    { enabled: open && !!appointment && !!patientId && isOrtho }
  )
  const paymentPlan = paymentPlanQuery.data?.plan ?? null
  const outstandingBalance = paymentPlanQuery.data?.outstandingBalance ?? 0

  const treatmentTypesQuery = useApiQuery<TreatmentType[]>(
    queryKeys.treatmentTypes.list(),
    () => getTreatmentTypes(),
    { enabled: open && !!appointment }
  )
  const treatmentTypesList = treatmentTypesQuery.data ?? []

  // The dropdown itself is now <PaymentMethodSelect> (fed by the configurable
  // lookup); this only seeds the default selection to `cash`.
  const { methods: paymentMethods } = usePaymentMethods()

  useEffect(() => {
    if (open && appointment && paymentMethods.length > 0) {
      const cashMethod = paymentMethods.find((m) => m.name === 'cash')
      setFormData((prev) => ({
        ...prev,
        method: cashMethod ? 'cash' : paymentMethods[0]?.name || '',
      }))
    }
  }, [open, appointment, paymentMethods])

  useEffect(() => {
    if (!open) {
      // Reset state when dialog closes
      setPaymentType(null)
      setFormData({
        amount: '',
        method: '',
        description: '',
        sendNotification: true,
      })
      setSelectedTreatmentTypes([])
    }
  }, [open])

  // Runs the appointment-workflow 'check-in' transition without creating a
  // payment. Used by the "No payment" card when the visit is already settled
  // or carries no charge.
  const handleNoPaymentCheckIn = () => {
    if (!appointment) {
      toast.error('Appointment not found')
      return
    }

    void submit(async () => {
      const res = await api.patch(`/api/appointment-workflow/${appointment.id}/transition`, {
        action: 'check-in',
      })
      if (res.success) {
        toast.success('Patient checked in')
        onSuccess?.()
        onOpenChange(false)
      } else {
        surfaceApiError(res, 'Failed to check in patient')
      }
    })
  }

  // Routes the card-grid selection. One-time / Plan advance to the payment
  // form; Insurance reuses the one-time flow with `method='insurance'`
  // preset; No payment runs the check-in transition directly.
  const handleSelectType = (type: CheckInPaymentType) => {
    if (type === 'no-payment') {
      handleNoPaymentCheckIn()
      return
    }
    if (type === 'insurance') {
      setFormData((prev) => ({ ...prev, method: 'insurance' }))
    }
    setPaymentType(type)
  }

  // For the form branches below, one-time + insurance share the same treatment-
  // type requirement; plan does not.
  const isOneTimeLike = paymentType === 'one-time' || paymentType === 'insurance'

  const handleCheckInWithPayment = (e: React.FormEvent) => {
    e.preventDefault()

    if (!appointment) {
      toast.error('Appointment not found')
      return
    }

    if (!paymentType || paymentType === 'no-payment') {
      toast.error('Please select a payment type')
      return
    }

    if (!formData.method) {
      toast.error('Please select a payment method')
      return
    }

    const parsedAmount = parseFloat(formData.amount)
    if (!formData.amount || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error('Please enter a valid amount')
      return
    }

    // API expects cents
    const amountCents = Math.round(parsedAmount * 100)

    if (paymentType === 'plan' && outstandingBalance > 0 && amountCents > outstandingBalance) {
      toast.error(
        `Amount cannot exceed the outstanding balance of GH₵ ${Number(outstandingBalance / 100).toFixed(2)}`
      )
      return
    }

    if (isOneTimeLike && selectedTreatmentTypes.length === 0) {
      toast.error('Please select at least one service category')
      return
    }

    void submit(async () => {
      // amount is in cents
      const amountToSend = amountCents

      // Build description
      let description =
        formData.description || `Payment for ${appointment.type || 'appointment'} appointment`

      // For one-time / insurance payments, try to get treatment type names for description
      if (isOneTimeLike && selectedTreatmentTypes.length > 0) {
        // If we have treatment types loaded, use their names
        if (treatmentTypesList && treatmentTypesList.length > 0) {
          const selectedNames = treatmentTypesList
            .filter((type) => selectedTreatmentTypes.includes(type.id))
            .map((type) => type.displayName || type.name)

          if (selectedNames.length > 0) {
            description = selectedNames.join(', ')

            // Append additional notes if provided
            if (formData.description?.trim()) {
              description = `${description} - ${formData.description.trim()}`
            }
          }
        } else {
          // Fallback if treatment types aren't loaded yet
          description =
            formData.description ||
            `One-time payment for ${appointment.type || 'appointment'} appointment`
        }
      }

      // Create payment data
      interface PaymentData {
        patientId: string
        appointmentId: string
        amount: number
        method: string
        description: string
        status: string
        sendNotification: boolean
        paymentPlanId?: string
        treatments?: Array<{ treatmentId: string; name: string; amount: number }>
      }
      const paymentData: PaymentData = {
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        amount: amountToSend,
        method: formData.method,
        description: description,
        status: 'completed',
        sendNotification: formData.sendNotification,
      }

      // Add payment plan ID if applicable
      if (paymentType === 'plan' && paymentPlan) {
        paymentData.paymentPlanId = paymentPlan.id
      }

      // Populate legacy treatments JSONB for one-time / insurance payments so
      // the SMS template and receipt paymentFor logic can read structured names.
      if (isOneTimeLike && selectedTreatmentTypes.length > 0) {
        paymentData.treatments = selectedTreatmentTypes.map((id) => ({
          treatmentId: id,
          name: treatmentTypesList.find((t) => t.id === id)?.name ?? id,
          amount: 0, // legacy field — allocation lives on invoice_lines
        }))
      }

      // Create the payment
      const paymentResult = await createPayment(paymentData)

      if (!paymentResult.success) {
        surfaceApiError(paymentResult, 'Failed to process payment')
        return
      }

      // Run the check-in workflow transition (sets checkedInAt timestamp, fires
      // enrichAppointment + syncAppointmentUpdated — same path as handleNoPaymentCheckIn)
      const workflowRes = await api.patch(
        `/api/appointment-workflow/${appointment.id}/transition`,
        { action: 'check-in' }
      )

      if (!workflowRes.success) {
        toast.error(
          'Payment processed but failed to update appointment status — please update it manually'
        )
        // Close the dialog so the form cannot be re-submitted and double-charge the patient
        onSuccess?.()
        onOpenChange(false)
        return
      }

      // Create pending medical record entry for the doctor
      const { createPendingMedicalRecord } = await import('@/lib/actions/medical-records')
      try {
        await createPendingMedicalRecord({
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          appointmentId: appointment.id,
        })
      } catch (error) {
        console.error('Failed to create pending medical record:', error)
        // Don't fail the check-in if this fails, just log it
      }

      // Generate receipt if payment was successful
      if (paymentResult.data && appointment.patient?.name) {
        try {
          const planTotal =
            paymentType === 'plan' && paymentPlan
              ? typeof paymentPlan.totalAmountCents === 'number'
                ? paymentPlan.totalAmountCents
                : typeof paymentPlan.totalAmount === 'number'
                  ? paymentPlan.totalAmount
                  : undefined
              : undefined

          // Round balance to avoid floating-point drift on the receipt
          const receiptBalance =
            paymentType === 'plan' && outstandingBalance > 0
              ? outstandingBalance - amountToSend
              : undefined

          generatePaymentReceipt({
            paymentId: paymentResult.data.id,
            patientName: appointment.patient.name,
            amountPaid: amountToSend,
            paymentMethod: formData.method,
            description: description,
            appointmentDate: new Date(), // Payment date (today)
            paymentType: paymentType,
            paymentPlanTotal: planTotal,
            paymentPlanBalance: receiptBalance,
            autoPrint: true,
          })
        } catch (error) {
          console.error('Failed to generate receipt:', error)
        }
      }

      toast.success('Patient checked in and payment processed successfully!')
      onSuccess?.()
      onOpenChange(false)
    })
  }

  // Dirty guard: form is dirty when the user has entered an amount or selected
  // treatment types (Step 2 of the two-step flow).
  const isFormDirty =
    paymentType !== null && (formData.amount !== '' || selectedTreatmentTypes.length > 0)

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isFormDirty,
    onClose: () => onOpenChange(false),
  })

  if (!appointment) return null

  return (
    <>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      <Dialog open={open} onOpenChange={guardedOnOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Check In & Process Payment</DialogTitle>
            <DialogDescription>
              Check in {appointment.patient?.name} and process their payment
            </DialogDescription>
          </DialogHeader>

          {!paymentType ? (
            // Step 1: Choose payment type (2×2 card grid — M3.2)
            <div className="space-y-4 py-4">
              <Label>Select Payment Type</Label>
              <CheckInPaymentCardGrid planAvailable={isOrtho} onSelect={handleSelectType} />

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => guardedOnOpenChange(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            // Step 2: Payment form
            <form onSubmit={handleCheckInWithPayment} className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setPaymentType(null)}
                  disabled={isSubmitting}
                  aria-label="Go back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="text-sm font-medium">
                  {paymentType === 'one-time'
                    ? 'One-Time Payment'
                    : paymentType === 'plan'
                      ? 'Payment Plan'
                      : 'Insurance Payment'}
                </div>
              </div>

              {/* Amount */}
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (GHS) *</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault()
                  }}
                  required
                />
                {paymentType === 'plan' && outstandingBalance > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Outstanding balance: GH₵ {formatAmount(Number(outstandingBalance))}
                  </p>
                )}
              </div>

              {/* Treatment Types (One-Time + Insurance) */}
              {isOneTimeLike && (
                <div className="space-y-2">
                  <Label>Service Categories *</Label>
                  <TreatmentTypesMultiSelect
                    value={selectedTreatmentTypes}
                    onChange={setSelectedTreatmentTypes}
                    placeholder="Select service categories..."
                  />
                </div>
              )}

              {/* Payment Method */}
              <div className="space-y-2">
                <Label htmlFor="method">Payment Method *</Label>
                <PaymentMethodSelect
                  id="method"
                  value={formData.method}
                  onValueChange={(value) => setFormData({ ...formData, method: value })}
                  placeholder="Select method"
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description (Optional)</Label>
                <Input
                  id="description"
                  placeholder="Add payment notes..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  maxLength={500}
                />
              </div>

              {/* Send Notification */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="sendNotification"
                  checked={formData.sendNotification}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, sendNotification: checked as boolean })
                  }
                />
                <Label htmlFor="sendNotification" className="text-sm font-normal cursor-pointer">
                  Send payment receipt via SMS
                </Label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => guardedOnOpenChange(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Check In & Pay
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
