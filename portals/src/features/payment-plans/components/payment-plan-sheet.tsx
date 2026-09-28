import { Pencil, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  computePlanTotals,
  makeEmptyLine,
  type PlanLine,
  PlanLineItemsEditor,
} from '@/features/payment-plans/components/plan-line-items-editor'
import { createPaymentPlanWithLines, updatePaymentPlan } from '@/lib/actions/payment-plans'
import { api } from '@/lib/api-client'
import type { paymentPlans } from '@/lib/db/schema'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Switch } from '@/shared/components/ui/switch'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { centsToInput, formatCurrency, inputToCents } from '@/shared/utils/currency'

const paymentFrequencySchema = z.enum(['weekly', 'biweekly', 'monthly'])

type PaymentPlan = typeof paymentPlans.$inferSelect

/** The subset of the invoice payload used to seed plan lines. */
type SourceInvoice = {
  /** Already settled against this estimate — a deposit taken at confirm time. */
  paidAmount?: number | string | null
  balance?: number | string | null
  lines?: Array<{
    serviceId?: string | null
    description?: string | null
    quantity?: number | string | null
    unitPrice?: number | string | null
    specialistId?: string | null
  }>
}

interface PaymentPlanSheetProps {
  patientId: string
  existingPlan?: PaymentPlan | null
  onSuccess?: () => void
  isAdmin?: boolean
  /**
   * Controlled mode. When `open` is supplied the built-in trigger button is not
   * rendered and the caller drives visibility — used by surfaces that already
   * have their own action button (e.g. the Activity worklist rows, the
   * patient ledger's Payment Plans tab).
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * Seed the line editor from an existing invoice instead of starting blank.
   * Used by reception's "Create plan" on the Activity worklist, which builds the
   * plan out of the invoice the doctor's estimate produced. Lines remain fully
   * editable afterwards. Ignored when editing an existing plan.
   */
  sourceInvoiceId?: string | null
}

/**
 * The single "create a payment plan" form — used both from the patient
 * ledger's Payment Plans tab and from the Activity worklist's "Confirm
 * estimate → Create a plan" flow (via `sourceInvoiceId`). These used to be
 * two separate implementations (this file, plus an inline `CreatePlanSheet`
 * in patient-ledger-tab.tsx) that had drifted apart, and this one used to
 * *require* picking a saved payment-plan template before a fixed schedule
 * could be created. There is no template concept at all now — the
 * per-installment amount and frequency are set directly below.
 */
export function PaymentPlanSheet({
  patientId,
  existingPlan,
  onSuccess,
  isAdmin = false,
  open: controlledOpen,
  onOpenChange,
  sourceInvoiceId,
}: PaymentPlanSheetProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = useCallback(
    (next: boolean) => {
      if (isControlled) onOpenChange?.(next)
      else setUncontrolledOpen(next)
    },
    [isControlled, onOpenChange]
  )
  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()

  const [additionalNotes, setAdditionalNotes] = useState('')
  const [lines, setLines] = useState<PlanLine[]>([])
  const [planType, setPlanType] = useState<'fixed' | 'flexible'>('fixed')
  const [flexibleTotalAmount, setFlexibleTotalAmount] = useState<string>('')
  // Fixed-plan cadence — set directly.
  const [amountPerInstallment, setAmountPerInstallment] = useState('')
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly'>('monthly')
  const [startDate, setStartDate] = useState('')
  const [sendSms, setSendSms] = useState(true)

  // Baseline snapshot captured on open — used for dirty detection in edit mode.
  const baselineLinesRef = useRef<string>('[]')

  const isLocked = !!existingPlan && !isAdmin
  /**
   * A plan built from an estimate bills that estimate EXACTLY — the backend
   * converts the estimate into the plan's master invoice rather than minting a
   * second one. Editing the lines here would mean silently altering an already
   * issued invoice, so they are read-only; corrections go through a credit note.
   */
  const billsExistingEstimate = !existingPlan && !!sourceInvoiceId
  /** Deposit already paid on the estimate — the installments cover the rest. */
  const [sourcePaidAmount, setSourcePaidAmount] = useState(0)

  // Same endpoint + key confirm-estimate-sheet.tsx's line read uses.
  const sourceInvoiceQuery = useApiQuery<SourceInvoice>(
    queryKeys.invoices.detail(sourceInvoiceId || 'none'),
    () => api.get<SourceInvoice>(`/api/invoices/${sourceInvoiceId}`),
    { enabled: open && !existingPlan && !!sourceInvoiceId }
  )

  const lineTotals = useMemo(() => computePlanTotals(lines), [lines])

  const numberOfInstallments = useMemo(() => {
    if (planType !== 'fixed') return 0
    const perCents = inputToCents(amountPerInstallment)
    if (perCents <= 0 || lineTotals.total <= 0) return 0
    return Math.ceil(lineTotals.total / perCents)
  }, [planType, amountPerInstallment, lineTotals.total])

  useEffect(() => {
    if (!open) return
    setAdditionalNotes(existingPlan?.notes || '')
    // Hydrate from legacy `treatments` JSONB when editing a pre-Phase-3 plan.
    // New plans will overwrite these via the line editor.
    const legacy =
      (existingPlan?.treatments as Array<{
        treatmentId: string
        name: string
        amount: number
      }> | null) || []
    const hydratedLines =
      legacy.length > 0
        ? legacy.map((t) => ({
            ...makeEmptyLine(),
            description: t.name,
            unitPrice: Number(t.amount) || 0,
            quantity: 1,
            treatmentTypeId: t.treatmentId || null,
          }))
        : []
    setLines(hydratedLines)
    // Capture baseline after hydration so edit-mode dirty detection works correctly.
    baselineLinesRef.current = JSON.stringify(hydratedLines)
    // Cleared on every open: a deposit from a previously viewed estimate must
    // not carry over and understate the next plan's schedule.
    setSourcePaidAmount(0)
    setPlanType(existingPlan?.type === 'flexible' ? 'flexible' : 'fixed')
    setFlexibleTotalAmount(existingPlan?.totalAmount ? centsToInput(existingPlan.totalAmount) : '')
    setAmountPerInstallment(
      existingPlan?.amountPerInstallment ? centsToInput(existingPlan.amountPerInstallment) : ''
    )
    setFrequency(
      paymentFrequencySchema.safeParse(existingPlan?.paymentFrequency).success
        ? (existingPlan?.paymentFrequency as 'weekly' | 'biweekly' | 'monthly')
        : 'monthly'
    )
    setStartDate('')
    setSendSms(true)
    setStatusMessage(undefined)
  }, [open, existingPlan])

  // New plan seeded from an invoice — pull its lines in as the starting point
  // once the query above resolves. Fires after the reset effect so it wins
  // (the query result only lands on a later render), and stays out of the
  // baseline so the seeded rows don't count as unsaved edits when the user
  // closes untouched.
  useEffect(() => {
    if (!open || existingPlan || !sourceInvoiceId) return
    const data = sourceInvoiceQuery.data
    if (!data?.lines?.length) return
    const seeded = data.lines.map((l) => ({
      ...makeEmptyLine(),
      serviceId: l.serviceId ?? null,
      description: l.description || 'Service',
      quantity: Number(l.quantity) || 1,
      unitPrice: Number(l.unitPrice) || 0,
      doctorId: l.specialistId ?? null,
    }))
    setLines(seeded)
    baselineLinesRef.current = JSON.stringify(seeded)
    setSourcePaidAmount(Number(data.paidAmount ?? 0) || 0)
  }, [open, existingPlan, sourceInvoiceId, sourceInvoiceQuery.data])

  // Dirty state — compared against the existing plan's baseline values, or
  // "has any input been provided" for a new plan.
  // In edit mode: only notes can be saved (line-edits are Phase 4+), so only
  // track notes changes to avoid misleading discard-confirmation prompts.
  const isDirty = useMemo(() => {
    if (existingPlan) {
      return additionalNotes !== (existingPlan.notes || '')
    }
    return (
      lines.length > 0 ||
      additionalNotes !== '' ||
      flexibleTotalAmount !== '' ||
      amountPerInstallment !== '' ||
      startDate !== '' ||
      JSON.stringify(lines) !== baselineLinesRef.current
    )
  }, [existingPlan, additionalNotes, lines, flexibleTotalAmount, amountPerInstallment, startDate])

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => setOpen(false),
  })

  function handleSubmit() {
    void submit(async () => {
      setStatusMessage(undefined)

      if (lines.length === 0) {
        toast.error('Add at least one line item.')
        return
      }
      for (const ln of lines) {
        if (!ln.description.trim()) {
          toast.error('Every line needs a description.')
          return
        }
        if (ln.unitPrice <= 0) {
          toast.error(`"${ln.description || 'Line'}" needs a unit price greater than 0.`)
          return
        }
      }
      let perInstallmentCents = 0
      if (planType === 'fixed') {
        perInstallmentCents = inputToCents(amountPerInstallment)
        if (perInstallmentCents <= 0) {
          toast.error('Set the per-installment amount for a fixed plan.')
          return
        }
        if (perInstallmentCents > lineTotals.total) {
          toast.error('Per-installment amount cannot exceed the plan total.')
          return
        }
      }
      // Flexible plan: total amount is required — do not allow silent 0-defaulting.
      // Not when billing an estimate: the amount comes from the estimate, so
      // asking the user to retype it invites a mismatch.
      if (planType === 'flexible' && !billsExistingEstimate && flexibleTotalAmount.trim() === '') {
        toast.error('Enter the total amount for a flexible plan.')
        return
      }
      if (
        planType === 'flexible' &&
        !billsExistingEstimate &&
        Math.abs(lineTotals.total - inputToCents(flexibleTotalAmount)) > 0
      ) {
        toast.error('Line total does not match the flexible plan total you entered.')
        return
      }

      const apiLines = lines.map((l) => ({
        treatmentId: l.treatmentTypeId,
        serviceId: l.serviceId,
        description: l.description.trim() || 'Service',
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountType: l.discountType,
        discountValue: l.discountValue,
        specialistId: l.doctorId,
        commissionRate: l.commissionRate,
      }))

      try {
        if (existingPlan) {
          // Editing an existing plan — for now we only update metadata.
          // Full line-level edits land in Phase 4 alongside per-invoice payments.
          const result = await updatePaymentPlan(existingPlan.id, {
            notes: additionalNotes.trim() || null,
          })
          if (!result.success) {
            setStatusMessage(result.error || 'Failed to save payment plan')
            surfaceApiError(result, 'Failed to save payment plan')
            return
          }
          toast.success('Plan notes updated.')
        } else {
          const result = await createPaymentPlanWithLines({
            patientId,
            // Converts the estimate into this plan's master invoice (P-1).
            sourceInvoiceId: sourceInvoiceId ?? null,
            scheduleType: planType,
            startDate: startDate ? new Date(startDate).toISOString() : undefined,
            numberOfInstallments: planType === 'fixed' ? numberOfInstallments : undefined,
            paymentFrequency: planType === 'fixed' ? frequency : undefined,
            notes: additionalNotes.trim() || null,
            sendSms,
            lines: apiLines,
          })
          if (!result.success) {
            setStatusMessage(result.error || 'Failed to save payment plan')
            surfaceApiError(result, 'Failed to save payment plan')
            return
          }
          toast.success('Payment plan created.')
        }
        setOpen(false)
        onSuccess?.()
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'An error occurred while saving the payment plan'
        setStatusMessage(message)
        toast.error(message)
      }
    })
  }

  const submitLabel = existingPlan ? (isAdmin ? 'Save changes' : 'Locked') : 'Create plan'
  const submitDisabled =
    !isDirty ||
    (planType === 'fixed' && !existingPlan && inputToCents(amountPerInstallment) <= 0) ||
    lines.length === 0 ||
    isLocked ||
    isSubmitting

  return (
    <>
      {!isControlled && (
        <Button
          variant={existingPlan ? 'outline' : 'default'}
          onClick={() => setOpen(true)}
          disabled={!!existingPlan && !isAdmin}
        >
          {existingPlan ? (
            <>
              <Pencil className="mr-2 h-4 w-4" />
              {isAdmin ? 'Change Payment Plan (Admin Only)' : 'View Payment Plan'}
            </>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Select Payment Plan
            </>
          )}
        </Button>
      )}

      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title={
          existingPlan
            ? isAdmin
              ? 'Change Payment Plan (Admin Only)'
              : 'Payment Plan Details'
            : 'New Payment Plan'
        }
        description={
          existingPlan
            ? isAdmin
              ? 'Only administrators can change the payment plan once it has been selected.'
              : 'This payment plan has been locked. Only administrators can make changes.'
            : 'Add line items, then set a fixed installment schedule or a flexible total.'
        }
        size="lg"
        submitLabel={submitLabel}
        submitting={isSubmitting}
        submitDisabled={submitDisabled}
        onSubmit={handleSubmit}
        statusMessage={statusMessage}
      >
        <div className="grid gap-4">
          {existingPlan && isAdmin && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
              In this version only the <strong>Additional Notes</strong> field can be saved. Full
              line-item editing will be available in a future release.
            </p>
          )}
          <div className="space-y-3">
            <Label>Plan Type *</Label>
            <div className="flex gap-4">
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="fixed"
                  name="planType"
                  value="fixed"
                  checked={planType === 'fixed'}
                  onChange={() => setPlanType('fixed')}
                  disabled={isLocked}
                  className="h-4 w-4"
                />
                <Label htmlFor="fixed" className="cursor-pointer font-normal">
                  Fixed Schedule
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="flexible"
                  name="planType"
                  value="flexible"
                  checked={planType === 'flexible'}
                  onChange={() => setPlanType('flexible')}
                  disabled={isLocked}
                  className="h-4 w-4"
                />
                <Label htmlFor="flexible" className="cursor-pointer font-normal">
                  Flexible Installments
                </Label>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {planType === 'fixed'
                ? 'Fixed schedule with regular installments'
                : 'Flexible payments without fixed schedule'}
            </p>
          </div>

          {planType === 'flexible' && (
            <div className="space-y-2">
              <Label htmlFor="flexibleAmount">Total Amount *</Label>
              <Input
                id="flexibleAmount"
                type="text"
                inputMode="decimal"
                placeholder="Enter total amount (e.g., 2000)"
                value={flexibleTotalAmount}
                onChange={(e) => {
                  // Strip non-numeric chars and allow at most one decimal point.
                  const value = e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
                  setFlexibleTotalAmount(value)
                }}
                disabled={isLocked}
                required
              />
              <p className="text-sm text-muted-foreground">
                Enter the total amount exactly as needed (e.g., 2000 for GHS 2,000.00)
              </p>
            </div>
          )}

          {planType === 'fixed' && !existingPlan && (
            <div className="space-y-3 rounded-lg border bg-muted/50 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pp-per-install" className="text-xs">
                    Per installment (GHS) *
                  </Label>
                  <Input
                    id="pp-per-install"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className="h-9"
                    value={amountPerInstallment}
                    onChange={(e) => setAmountPerInstallment(e.target.value)}
                    disabled={isLocked}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pp-num-install" className="text-xs">
                    No. of installments
                  </Label>
                  <Input
                    id="pp-num-install"
                    type="number"
                    placeholder="Auto"
                    className="h-9 bg-muted/40"
                    value={numberOfInstallments || ''}
                    readOnly
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Payment frequency *</Label>
                  <Select
                    value={frequency}
                    onValueChange={(v) => setFrequency(v as typeof frequency)}
                    disabled={isLocked}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Bi-weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pp-start" className="text-xs">
                    Start date
                  </Label>
                  <Input
                    id="pp-start"
                    type="date"
                    className="h-9"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    disabled={isLocked}
                  />
                </div>
              </div>
              {lineTotals.total > 0 && (
                <p className="text-xs text-muted-foreground">
                  Plan total:{' '}
                  <span className="font-semibold">{formatCurrency(lineTotals.total)}</span>
                </p>
              )}
            </div>
          )}

          <PlanLineItemsEditor
            value={lines}
            onChange={setLines}
            disabled={isLocked || billsExistingEstimate}
            alreadyPaid={billsExistingEstimate ? sourcePaidAmount : 0}
          />
          {billsExistingEstimate && (
            <p className="mt-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              These lines come from the estimate and bill it exactly — the estimate becomes this
              plan's invoice, so it is charged once. To change the amount, issue a credit note
              against the estimate.
            </p>
          )}
          <p className="text-xs text-muted-foreground -mt-2">
            Pick a service per line — unit price, doctor, and commission rate auto-fill from the
            service catalog. Discount applies per line (₵ or %).
          </p>

          <div className="space-y-2">
            <Label htmlFor="additionalNotes">Additional Notes (Optional)</Label>
            <Textarea
              id="additionalNotes"
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              placeholder="Additional notes about this payment plan"
              disabled={isLocked}
              maxLength={1000}
            />
          </div>

          {!existingPlan && (
            <div className="flex items-start gap-3 rounded-md border bg-muted/20 p-3">
              <Switch
                id="pp-send-sms"
                checked={sendSms}
                onCheckedChange={setSendSms}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <Label htmlFor="pp-send-sms" className="text-xs cursor-pointer">
                  Notify patient by SMS
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Sends a summary of the plan (total, installments, treatments) to the patient.
                </p>
              </div>
            </div>
          )}
        </div>
      </SheetFormLayout>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
