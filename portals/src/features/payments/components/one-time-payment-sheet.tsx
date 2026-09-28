import { ArrowLeft, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  TreatmentPaymentInput,
  type TreatmentPaymentItem,
} from '@/features/payments/components/treatment-payment-input'
import { getPatient } from '@/lib/actions/patients'
import { createPayment } from '@/lib/actions/payments'
import type { treatmentTypes } from '@/lib/db/schema'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PatientPicker } from '@/shared/components/patient-picker'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { usePaymentMethods } from '@/shared/hooks/use-payment-methods'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { generatePaymentReceipt } from '@/shared/utils/receipt'

type TreatmentType = typeof treatmentTypes.$inferSelect

interface OneTimePaymentSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  /**
   * Locks the payment to this patient — the picker is replaced by a read-only
   * readout. Only pass this when the caller genuinely knows the patient (e.g.
   * appointment check-in); leave it unset to let staff choose in the form.
   */
  presetPatientId?: string
  /**
   * When set, the footer's Back button returns to the previous step of a
   * multi-step flow instead of closing the sheet outright. Guarded by the same
   * discard prompt as closing.
   */
  onBack?: () => void
}

export function OneTimePaymentSheet({
  open,
  onOpenChange,
  onSuccess,
  presetPatientId,
  onBack,
}: OneTimePaymentSheetProps) {
  const { isSubmitting, submit } = useSubmitGuard()
  // Only used for the locked/preset readout below — the interactive
  // <PatientPicker> searches the server itself and never needs this.
  const presetPatientQuery = useApiQuery(
    queryKeys.patients.detail(presetPatientId ?? ''),
    async () =>
      presetPatientId ? getPatient(presetPatientId) : { success: true as const, data: null },
    { enabled: open && !!presetPatientId }
  )
  const { methods: paymentMethods } = usePaymentMethods()
  const [formData, setFormData] = useState({
    patientId: '',
    amount: '',
    method: '',
    description: '',
    sendNotification: true,
  })
  const [treatments, setTreatments] = useState<TreatmentPaymentItem[]>([])

  // Dirty-guard: the form is considered dirty once a patient has been selected
  // or any treatment has been added.
  const isDirty = !!formData.patientId || treatments.length > 0
  // The discard guard takes a single `onClose`, but this sheet has two exits:
  // closing (X / ESC / outside click) and stepping Back to the previous stage.
  // Record which one was requested so the confirm prompt resolves to the right
  // one after the user confirms.
  const exitIntent = useRef<'close' | 'back'>('close')
  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => {
      if (exitIntent.current === 'back' && onBack) {
        exitIntent.current = 'close'
        onBack()
        return
      }
      onOpenChange(false)
    },
  })

  const requestClose = (nextOpen: boolean) => {
    if (!nextOpen) exitIntent.current = 'close'
    guardedOnOpenChange(nextOpen)
  }

  const requestBack = () => {
    exitIntent.current = onBack ? 'back' : 'close'
    guardedOnOpenChange(false)
  }

  // Apply the preset whenever it changes while the sheet is open (e.g. the
  // Accept Payment flow opens this with the check-in patient already known).
  useEffect(() => {
    if (!open) return
    if (presetPatientId) {
      setFormData((prev) => ({ ...prev, patientId: presetPatientId }))
    }
  }, [open, presetPatientId])

  // Seed the default method once the lookup loads — only when the user
  // hasn't picked one yet, so a re-fetch never clobbers their selection.
  useEffect(() => {
    if (!open || paymentMethods.length === 0) return
    const cashMethod = paymentMethods.find((m) => m.name === 'cash')
    setFormData((prev) =>
      prev.method
        ? prev
        : { ...prev, method: cashMethod ? 'cash' : (paymentMethods[0]?.name ?? '') }
    )
  }, [open, paymentMethods])

  useEffect(() => {
    if (!open) {
      // Reset all form state on close so reopening always starts clean.
      setFormData({
        patientId: '',
        amount: '',
        method: '',
        description: '',
        sendNotification: true,
      })
      setTreatments([])
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await submit(async () => {
      if (!formData.patientId) {
        toast.error('Please select a patient')
        return
      }

      if (!formData.method) {
        toast.error('Please select a payment method')
        return
      }

      if (treatments.length === 0) {
        toast.error('Please select at least one treatment')
        return
      }

      // Check for zero amounts
      if (treatments.some((t) => t.amount <= 0 || !t.treatmentId)) {
        toast.error('All treatments must have a selected type and a valid amount greater than 0')
        return
      }

      // Calculate total amount
      const totalAmount = treatments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)

      // Generate description
      const treatmentNames = treatments.map((t) => t.name).join(', ')
      let description = treatmentNames

      // Append additional notes if provided
      if (formData.description.trim()) {
        description = `${description} - ${formData.description.trim()}`
      }

      // NOTE: `status` is intentionally omitted — the backend lifecycle owns
      // the status transition (draft → posted); sending a client-supplied
      // 'completed' value would land in the audit log as dead payload.
      //
      // Insurance used to be smuggled in here as `isInsurance` /
      // `insuranceCompanyId` / `insuranceAmount`, cast through `unknown` to get
      // past the payload type. The backend never read them, so those payments
      // were stored as ordinary cash. Insurance now raises a claim instead —
      // see `<InsuranceClaimSheet>`.
      const data = {
        patientId: formData.patientId,
        amount: totalAmount, // Store total
        method: formData.method,
        description: description,
        sendNotification: formData.sendNotification ?? false,
        treatments: treatments, // structured treatments JSON array
      } as unknown as Parameters<typeof createPayment>[0]

      const result = await createPayment(data)

      if (result.success) {
        if (result.smsError) {
          toast.warning(`Payment recorded, but SMS failed: ${result.smsError}`)
        } else {
          toast.success('Payment recorded successfully')
        }

        // Generate receipt
        try {
          const patientResult = await getPatient(formData.patientId)
          if (patientResult.success && patientResult.data) {
            generatePaymentReceipt({
              paymentId: result.data?.id,
              patientName: patientResult.data.name,
              amountPaid: data.amount,
              paymentMethod: formData.method,
              description: description, // Pass full description with treatment types
              paymentType: 'one-time',
            })
          }
        } catch {
          console.error('Failed to generate receipt')
          // Don't fail the payment if receipt generation fails
        }

        onOpenChange(false)
        const defaultMethod =
          paymentMethods.find((m) => m.name === 'cash')?.name || paymentMethods[0]?.name || ''
        setFormData({
          patientId: '',
          amount: '',
          method: defaultMethod,
          description: '',
          sendNotification: true,
        })
        setTreatments([])
        onSuccess?.()
      } else {
        surfaceApiError(result, 'Failed to record payment')
      }
    })
  }

  return (
    <>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      <Sheet open={open} onOpenChange={requestClose}>
        <SheetContent className="!w-full !max-w-[560px] overflow-y-auto">
          <form onSubmit={handleSubmit}>
            <SheetHeader className="mb-6">
              <SheetTitle>One-time Payment</SheetTitle>
              <SheetDescription>Record a one-time payment for a patient.</SheetDescription>
            </SheetHeader>
            <div className="grid gap-4">
              {presetPatientId ? (
                // Preset → patient is locked to the appointment's patient.
                // Render a non-interactive readout so it's clear who the
                // payment is being recorded for; no picker to second-guess.
                <div className="space-y-2">
                  <Label>Patient</Label>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    {(() => {
                      const patient = presetPatientQuery.data
                      if (!patient) return 'Loading patient…'
                      return (
                        <>
                          <span className="font-medium">{patient.name}</span>
                          {patient.patientId ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {patient.patientId}
                            </span>
                          ) : null}
                        </>
                      )
                    })()}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="one-time-patient">Select Patient *</Label>
                  <PatientPicker
                    id="one-time-patient"
                    value={formData.patientId}
                    onChange={(id) => setFormData({ ...formData, patientId: id })}
                    placeholder="Select a patient"
                    popoverWidthClass="w-[400px]"
                  />
                </div>
              )}

              {/* Removed standalone total amount input */}

              <div className="space-y-2">
                <Label htmlFor="method">Payment Method *</Label>
                <Select
                  value={formData.method}
                  onValueChange={(value) => setFormData({ ...formData, method: value })}
                >
                  <SelectTrigger id="method">
                    <SelectValue placeholder="Select payment method" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Insurance is deliberately absent, even if the backend's
                        payment_methods table seeds it: no money is collected at
                        the desk for an insured visit. Those go through the
                        Insurance card → <InsuranceClaimSheet>, which raises a
                        claim priced from the insurer's own list. */}
                    {paymentMethods
                      .filter((method) => method.name !== 'insurance')
                      .map((method) => (
                        <SelectItem key={method.id} value={method.name}>
                          {method.displayName || method.name.replace('_', ' ')}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Treatments *</Label>
                <TreatmentPaymentInput value={treatments} onChange={setTreatments} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Additional Notes (Optional)</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Additional payment notes"
                  maxLength={200}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="sendNotification"
                  checked={formData.sendNotification}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, sendNotification: checked === true })
                  }
                />
                <Label htmlFor="sendNotification" className="cursor-pointer">
                  Send Payment Notification (SMS)
                </Label>
              </div>
            </div>
            <SheetFooter className="mt-6">
              <Button type="button" variant="outline" onClick={requestBack} disabled={isSubmitting}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || treatments.length === 0 || !formData.method}
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Record Payment
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  )
}
