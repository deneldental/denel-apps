import { useEffect, useState } from 'react'
import {
  AcceptPaymentCardGrid,
  type AcceptPaymentType,
} from '@/features/payments/components/accept-payment-card-grid'
import { InsuranceClaimSheet } from '@/features/payments/components/insurance-claim-sheet'
import { OneTimePaymentSheet } from '@/features/payments/components/one-time-payment-sheet'
import { PlanPaymentSheet } from '@/features/payments/components/plan-payment-sheet'
import { Button } from '@/shared/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'

interface AcceptPaymentSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  /** When provided, the patient is locked to this id — the payment form renders
   *  a read-only patient readout instead of its picker. Used from the Today-tab
   *  check-in flow, where the patient is already known. */
  presetPatientId?: string
  /** Show the "No payment" card. Used by the appointment check-in flow so
   *  staff can complete the check-in without taking any money (with a
   *  reason captured). Handled outside this sheet — when the user picks
   *  "no-payment" we fire `onNoPayment` and close. */
  showNoPaymentOption?: boolean
  /** Fires when the user picks the "No payment" card. Caller is responsible
   *  for collecting the reason + finalising the check-in. */
  onNoPayment?: () => void
}

type Stage = 'select-type' | 'open-form'

/**
 * Accept Payment sheet (M5.3 — Phase B).
 *
 * Two-stage flow, both stages rendered as a slide-in side sheet:
 *   1. Card grid: pick payment type (one-time / plan / insurance).
 *   2. The matching payment form, which owns its own patient selector.
 *
 * There used to be a third stage — a standalone patient picker between the two.
 * It was redundant: both payment forms already render a `<PatientPicker>`, and
 * feeding them the selection as `presetPatientId` only switched them into the
 * locked read-only readout meant for check-in. The picker now lives in the form
 * where the rest of the payment is entered, and `presetPatientId` is back to
 * meaning what its name says — a caller-supplied lock.
 *
 * Insurance is NOT a payment form. No money is taken at the desk: the clinic
 * raises a claim against the insurer, priced from that insurer's own list, and
 * the Claims page runs it from there. So the Insurance card routes to
 * `<InsuranceClaimSheet>`, and "Insurance" is no longer a method in the
 * one-time / plan dropdowns.
 */
export function AcceptPaymentSheet({
  open,
  onOpenChange,
  onSuccess,
  presetPatientId,
  showNoPaymentOption = false,
  onNoPayment,
}: AcceptPaymentSheetProps) {
  const [stage, setStage] = useState<Stage>('select-type')
  const [paymentType, setPaymentType] = useState<AcceptPaymentType | null>(null)

  useEffect(() => {
    if (!open) {
      // Reset the flow when the sheet closes so reopening always starts clean
      // at the card grid.
      setStage('select-type')
      setPaymentType(null)
    }
  }, [open])

  const handleSelectType = (type: AcceptPaymentType) => {
    // "No payment" is a check-in escape hatch — close this sheet and let the
    // caller open its own reason-capture surface. No payment form routing.
    if (type === 'no-payment') {
      onOpenChange(false)
      onNoPayment?.()
      return
    }
    setPaymentType(type)
    setStage('open-form')
  }

  const handleBackToTypes = () => {
    setStage('select-type')
    setPaymentType(null)
  }

  const handleChildSuccess = () => {
    setStage('select-type')
    setPaymentType(null)
    onSuccess?.()
  }

  // Stage 2 — delegate to the payment forms. Each is a sheet of its own, so the
  // surface stays a side panel the whole way through; `onBack` returns to the
  // card grid rather than dropping the user out of the flow.
  if (stage === 'open-form' && paymentType) {
    if (paymentType === 'plan') {
      return (
        <PlanPaymentSheet
          open={open}
          onOpenChange={onOpenChange}
          onSuccess={handleChildSuccess}
          onBack={handleBackToTypes}
          presetPatientId={presetPatientId}
        />
      )
    }
    if (paymentType === 'insurance') {
      return (
        <InsuranceClaimSheet
          open={open}
          onOpenChange={onOpenChange}
          onSuccess={handleChildSuccess}
          onBack={handleBackToTypes}
          presetPatientId={presetPatientId}
        />
      )
    }
    return (
      <OneTimePaymentSheet
        open={open}
        onOpenChange={onOpenChange}
        onSuccess={handleChildSuccess}
        onBack={handleBackToTypes}
        presetPatientId={presetPatientId}
      />
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="!w-full !max-w-[760px] overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>Accept Payment</SheetTitle>
          <SheetDescription>Select the type of payment you want to accept.</SheetDescription>
        </SheetHeader>

        <AcceptPaymentCardGrid onSelect={handleSelectType} includeNoPayment={showNoPaymentOption} />

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
