import { ArrowLeft, Loader2, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  type PaymentSourceRow,
  paymentSourcesBalance,
  paymentSourcesBalanceLabel,
  paymentSourcesTotalCents,
} from '@/features/payments/payment-sources'
import { checkInAppointment } from '@/lib/actions/appointments'
import { getPatient } from '@/lib/actions/patients'
import { createPayment } from '@/lib/actions/payments'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PatientPicker } from '@/shared/components/patient-picker'
import {
  computeServiceLinesTotal,
  previewServiceLine,
  type ServiceLine,
  ServiceLinesEditor,
  serviceLinesNeedSurchargeConfirm,
  useServiceCatalog,
} from '@/shared/components/service-lines-editor'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
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
import { centsToInput, formatCurrency, inputToCents } from '@/shared/utils/currency'
import { generatePaymentReceipt } from '@/shared/utils/receipt'

/**
 * Methods this sheet never offers. Insurance: no money is collected at the desk for an insured
 * visit; those go through the Insurance card → <InsuranceClaimSheet>, which raises a claim priced
 * from the insurer's own list. The wallet: a one-time payment pays no invoice, so wallet credit
 * would pay nothing (it would come straight back as credit), and the server refuses it.
 */
const NOT_A_ONE_TIME_METHOD = ['insurance', 'wallet']

interface OneTimePaymentSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `checkedIn` is true when the payment was taken by a check-in request, which also checked the patient in. */
  onSuccess?: (info?: { checkedIn?: boolean }) => void
  /**
   * The visit this payment is for, at check-in. When set, the payment is taken BY
   * the check-in request (payment, status and the doctor's note are all or
   * nothing, and the payment names its visit) instead of as a separate payment.
   * The check-in request takes one payment with one method, so the sheet offers
   * no second method then.
   */
  appointmentId?: string
  /**
   * A visit that is already checked in (a walk-in): the payment is an ordinary one that
   * NAMES this visit, and nothing is checked in (F33). Ignored when `appointmentId` is set.
   */
  linkAppointmentId?: string
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
  appointmentId,
  linkAppointmentId,
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
    description: '',
    sendNotification: true,
  })
  const services = useServiceCatalog(open)
  const [lines, setLines] = useState<ServiceLine[]>([])
  const [paymentSources, setPaymentSources] = useState<PaymentSourceRow[]>([])
  const [confirmSurchargeOpen, setConfirmSurchargeOpen] = useState(false)

  const serviceTotal = computeServiceLinesTotal(lines)

  // Dirty-guard: the form is considered dirty once a patient has been selected
  // or any service has been added.
  const isDirty = !!formData.patientId || lines.length > 0
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

  // Seed a single default payment method once the lookup loads — only when the
  // cashier has not added any yet, so a re-fetch never clobbers an in-progress
  // split. This is the zero-extra-clicks path: one row, cash, taking the whole
  // total (the effect below keeps it in step with the total).
  useEffect(() => {
    if (!open || paymentMethods.length === 0) return
    setPaymentSources((prev) => {
      if (prev.length > 0) return prev
      // Insurance and the wallet are never methods of this payment (see availableMethodsFor), so
      // neither is the default: it could not even be shown in the row's own dropdown.
      const selectable = paymentMethods.filter((m) => !NOT_A_ONE_TIME_METHOD.includes(m.name))
      const cashMethod = selectable.find((m) => m.name === 'cash')
      const method = cashMethod ? 'cash' : (selectable[0]?.name ?? '')
      if (!method) return prev
      return [{ key: `${method}-${Date.now()}`, method, amount: centsToInput(serviceTotal) }]
    })
    // `serviceTotal` is read only when there is no row yet, so this seeds once per open.
  }, [open, paymentMethods, serviceTotal])

  // While there is exactly one method, its amount IS the total: it follows the services as they
  // change. The moment a second method exists the cashier is deliberately splitting, so the
  // amounts stop following (rewriting what they typed would fight them) and only the SUM is
  // checked against the total when the payment is recorded.
  useEffect(() => {
    if (paymentSources.length !== 1) return
    setPaymentSources((prev) => {
      if (prev.length !== 1) return prev
      return prev[0].amount === centsToInput(serviceTotal)
        ? prev
        : [{ ...prev[0], amount: centsToInput(serviceTotal) }]
    })
  }, [serviceTotal, paymentSources.length])

  useEffect(() => {
    if (!open) {
      // Reset all form state on close so reopening always starts clean.
      setFormData({
        patientId: '',
        description: '',
        sendNotification: true,
      })
      setLines([])
      setPaymentSources([])
    }
  }, [open])

  const resetForm = () => {
    setFormData({
      patientId: '',
      description: '',
      sendNotification: true,
    })
    setLines([])
    setPaymentSources([])
  }

  /** Human-readable line label for the payment description/receipt — the
   *  catalog name plus any picked variant / tooth class, so a matrix-priced
   *  service isn't recorded as just its bare name. */
  const describeLine = (line: ServiceLine): string => {
    const toothClass = line.toothClassId
      ? line.matrix?.toothClasses.find((tc) => tc.id === line.toothClassId)?.displayName
      : null
    const bits = [line.variantName, toothClass].filter(Boolean)
    return bits.length ? `${line.name} (${bits.join(', ')})` : line.name
  }

  /** A method's display name, falling back to its slug when the lookup has no row for it. */
  const methodDisplayName = (name: string) =>
    paymentMethods.find((m) => m.name === name)?.displayName || name.replace('_', ' ')

  const availableMethodsFor = (currentMethod: string) => {
    const used = new Set(paymentSources.map((s) => s.method).filter((m) => m !== currentMethod))
    return paymentMethods.filter(
      (m) => !NOT_A_ONE_TIME_METHOD.includes(m.name) && !used.has(m.name)
    )
  }
  // The check-in request takes one payment with one method, so no second method then.
  const canAddSource = !appointmentId && availableMethodsFor('').length > 0

  const addPaymentSource = () => {
    const next = availableMethodsFor('')[0]
    if (!next) return
    setPaymentSources((prev) => [
      ...prev,
      { key: `${next.name}-${Date.now()}`, method: next.name, amount: '' },
    ])
  }

  const removePaymentSource = (key: string) =>
    setPaymentSources((prev) => prev.filter((s) => s.key !== key))

  const setPaymentSource = (key: string, patch: Partial<PaymentSourceRow>) =>
    setPaymentSources((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  const doSubmit = async () => {
    await submit(async () => {
      // Each line is recorded with what it came to, surcharge and discount included.
      const treatments = lines.map((l) => ({
        treatmentId: l.serviceId,
        name: describeLine(l),
        amount: previewServiceLine(l).total,
      }))

      // Calculate total amount
      const totalAmount = computeServiceLinesTotal(lines)
      // "Cash + Card" for a split payment; just the one name for the common case.
      const paymentMethodLabel = paymentSources.map((s) => methodDisplayName(s.method)).join(' + ')

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
      //
      // The methods ARE the amount: `sources` carries each one in pesewas, and the server adds
      // them up itself, so there is no total here for it to disagree with.
      const data = {
        patientId: formData.patientId,
        sources: paymentSources.map((s) => ({ method: s.method, amount: inputToCents(s.amount) })),
        description: description,
        sendNotification: formData.sendNotification ?? false,
        treatments: treatments, // structured treatments JSON array
        // A walk-in's visit, named on the payment (it is already checked in).
        ...(linkAppointmentId ? { appointmentId: linkAppointmentId } : {}),
      } as unknown as Parameters<typeof createPayment>[0]

      // At check-in the payment travels INSIDE the check-in request, so it is
      // recorded against the visit and checks the patient in as one step: it
      // either all happens or none of it does. The request names no patient; the
      // server uses the visit's own.
      let paymentId: string | undefined
      let alreadyCheckedIn = false
      let result: { success: boolean; smsError?: string; error?: string }
      if (appointmentId) {
        const checkIn = await checkInAppointment(appointmentId, {
          payment: {
            amount: totalAmount,
            method: paymentSources[0].method,
            description,
            treatments,
            sendNotification: formData.sendNotification ?? false,
          },
        })
        result = checkIn
        paymentId = checkIn.data?.payment?.id
        alreadyCheckedIn = checkIn.data?.alreadyCheckedIn === true
      } else {
        const created = await createPayment(data)
        result = created
        paymentId = created.data?.id
      }

      if (result.success) {
        if (alreadyCheckedIn) {
          // A colleague (or an earlier attempt) already checked this patient in;
          // the server took no payment, so there is nothing to print.
          toast.warning('This patient was already checked in — no payment was taken.')
          onOpenChange(false)
          resetForm()
          onSuccess?.({ checkedIn: true })
          return
        }
        if (result.smsError) {
          toast.warning(`Payment recorded, but SMS failed: ${result.smsError}`)
        } else {
          toast.success(
            appointmentId
              ? 'Payment recorded and patient checked in'
              : 'Payment recorded successfully'
          )
        }

        // Generate receipt
        try {
          const patientResult = await getPatient(formData.patientId)
          if (patientResult.success && patientResult.data) {
            generatePaymentReceipt({
              paymentId,
              patientName: patientResult.data.name,
              amountPaid: totalAmount,
              paymentMethod: paymentMethodLabel,
              description: description, // Pass full description with treatment types
              paymentType: 'one-time',
            })
          }
        } catch {
          console.error('Failed to generate receipt')
          // Don't fail the payment if receipt generation fails
        }

        onOpenChange(false)
        resetForm()
        onSuccess?.(appointmentId ? { checkedIn: true } : undefined)
      } else {
        surfaceApiError(result, appointmentId ? 'Failed to check in' : 'Failed to record payment')
      }
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.patientId) {
      toast.error('Please select a patient')
      return
    }

    if (lines.length === 0) {
      toast.error('Please add at least one service')
      return
    }

    // Check for zero amounts
    if (lines.some((l) => previewServiceLine(l).total <= 0)) {
      toast.error('All services must have a valid amount greater than 0')
      return
    }

    if (paymentSources.length === 0 || paymentSources.some((s) => !s.method)) {
      toast.error('Please select a payment method')
      return
    }

    // A method with nothing against it would be refused by the server, and means nothing here.
    if (paymentSources.some((s) => inputToCents(s.amount) <= 0)) {
      toast.error('Each payment method needs an amount above 0')
      return
    }

    // The payment is recorded only when the methods add up to the services exactly.
    if (paymentSourcesBalance(paymentSources, serviceTotal) !== 0) {
      toast.error(
        `Payment methods total ${formatCurrency(paymentSourcesTotalCents(paymentSources))} but services total ${formatCurrency(serviceTotal)}`
      )
      return
    }

    // A surcharge that more than doubles a line is probably a mistyped value: ask first.
    if (serviceLinesNeedSurchargeConfirm(lines)) {
      setConfirmSurchargeOpen(true)
      return
    }

    await doSubmit()
  }

  const balance = paymentSourcesBalance(paymentSources, serviceTotal)

  return (
    <>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      <Sheet open={open} onOpenChange={requestClose}>
        <SheetContent className="!w-full !max-w-[560px] !p-0 flex flex-col">
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <SheetHeader className="shrink-0 space-y-1 border-b px-6 pt-6 pb-4 text-left">
              <SheetTitle>One-time Payment</SheetTitle>
              <SheetDescription>Record a one-time payment for a patient.</SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
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

              <ServiceLinesEditor services={services} lines={lines} setLines={setLines} />

              <div className="space-y-2">
                <Label>Payment Method{paymentSources.length > 1 ? 's' : ''} *</Label>
                <div className="space-y-2">
                  {paymentSources.map((source, index) => {
                    const isOnlyRow = paymentSources.length === 1
                    return (
                      <div key={source.key} className="flex items-start gap-2">
                        <Select
                          value={source.method}
                          onValueChange={(value) => setPaymentSource(source.key, { method: value })}
                        >
                          <SelectTrigger aria-label={`Payment method ${index + 1}`}>
                            <SelectValue placeholder="Select payment method" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableMethodsFor(source.method).map((method) => (
                              <SelectItem key={method.id} value={method.name}>
                                {method.displayName || method.name.replace('_', ' ')}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="relative w-[140px] shrink-0">
                          <span className="absolute left-3 top-2.5 text-xs text-muted-foreground">
                            GHS
                          </span>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            aria-label={`Amount for payment method ${index + 1}`}
                            value={source.amount}
                            onChange={(e) =>
                              setPaymentSource(source.key, { amount: e.target.value })
                            }
                            disabled={isOnlyRow}
                            className="pl-11"
                          />
                        </div>
                        {!isOnlyRow && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            onClick={() => removePaymentSource(source.key)}
                            aria-label={`Remove payment method ${index + 1}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
                {!appointmentId && (
                  <div className="flex items-center justify-between">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addPaymentSource}
                      disabled={!canAddSource}
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Add payment method
                    </Button>
                    {paymentSources.length > 1 && (
                      <span
                        className={cn(
                          'text-xs',
                          balance === 0 ? 'text-muted-foreground' : 'text-destructive'
                        )}
                      >
                        {paymentSourcesBalanceLabel(balance)}
                      </span>
                    )}
                  </div>
                )}
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
            </div>

            {/* Fixed footer: the total and what each line comes to, the text message choice, and
                the buttons. The body above scrolls; these stay in view. */}
            <div className="shrink-0 space-y-3 border-t bg-background px-6 py-4">
              <div className="space-y-1.5 rounded-lg bg-muted/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="text-lg font-semibold">{formatCurrency(serviceTotal)}</span>
                </div>
                {lines.length > 0 && (
                  <div className="max-h-24 space-y-0.5 overflow-y-auto border-t pt-1.5">
                    {lines.map((line) => (
                      <div
                        key={line.key}
                        className="flex items-center justify-between text-xs text-muted-foreground"
                      >
                        <span className="truncate pr-2">{describeLine(line)}</span>
                        <span className="shrink-0">
                          {formatCurrency(previewServiceLine(line).total)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
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

              <SheetFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={requestBack}
                  disabled={isSubmitting}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || lines.length === 0 || paymentSources.length === 0}
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Record Payment
                </Button>
              </SheetFooter>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <DeleteConfirmationDialog
        open={confirmSurchargeOpen}
        onOpenChange={setConfirmSurchargeOpen}
        onConfirm={doSubmit}
        tone="default"
        confirmLabel="Add anyway"
        title="Large surcharge"
        description="One or more surcharges more than double a line's standard price. Double-check the entered value before continuing."
      />
    </>
  )
}
