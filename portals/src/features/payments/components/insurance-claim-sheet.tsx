import { ArrowLeft, Loader2, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  TreatmentPaymentInput,
  type TreatmentPaymentItem,
} from '@/features/payments/components/treatment-payment-input'
import { createInsuranceClaim, type InsuranceClaimLineInput } from '@/lib/actions/insurance-claims'
import { getPatient, updatePatient } from '@/lib/actions/patients'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PatientPicker, type PickerPatient } from '@/shared/components/patient-picker'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useInsuranceCompanies } from '@/shared/hooks/use-insurance-companies'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { formatCurrency } from '@/shared/utils/currency'

interface InsuranceClaimSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  /** Locks the claim to this patient (e.g. appointment check-in). */
  presetPatientId?: string
  /** Returns to the previous step of a multi-step flow instead of closing. */
  onBack?: () => void
}

/**
 * Insurance claim sheet.
 *
 * Insurance is not a payment method — no money changes hands at the desk. The
 * clinic raises a **claim** against the insurer, which then runs its own
 * lifecycle (submit → approve/deny → pay) on the Claims page. That is why
 * "Insurance" was removed from the payment-method dropdowns: recording it there
 * booked insurer-owed work as collected cash.
 *
 * Pricing comes from the insurer, not the clinic. Once a company is selected,
 * `<TreatmentPaymentInput>` resolves each treatment through
 * `GET /api/services/lookup?insuranceCompanyId=`, which returns that insurer's
 * effective, approved price — so a consultation the clinic charges 100 for bills
 * at the insurer's 80. Changing the company re-prices every line already added.
 *
 * Treatments the insurer doesn't cover stay on the claim at the clinic's price
 * and are totalled separately as patient-owed; the insurer is only ever asked
 * for the covered lines (the server recomputes that total, ignoring ours).
 */
export function InsuranceClaimSheet({
  open,
  onOpenChange,
  onSuccess,
  presetPatientId,
  onBack,
}: InsuranceClaimSheetProps) {
  const { isSubmitting, submit } = useSubmitGuard()
  // Only used for the locked/preset readout — the interactive <PatientPicker>
  // searches the server itself and tracks the picked row via its onChange.
  const presetPatientQuery = useApiQuery(
    queryKeys.patients.detail(presetPatientId ?? ''),
    async () =>
      presetPatientId ? getPatient(presetPatientId) : { success: true as const, data: null },
    { enabled: open && !!presetPatientId }
  )
  const [pickedPatient, setPickedPatient] = useState<PickerPatient | null>(null)
  const { companies, isLoading: isLoadingCompanies } = useInsuranceCompanies(open)
  const [patientId, setPatientId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [policyNumber, setPolicyNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [treatments, setTreatments] = useState<TreatmentPaymentItem[]>([])
  // treatmentId → false when the insurer's effective list doesn't price it.
  const [coverage, setCoverage] = useState<Record<string, boolean>>({})
  // treatmentId → the clinic's own price, kept so an uncovered line can still
  // show what the patient owes.
  const [clinicPrices, setClinicPrices] = useState<Record<string, number>>({})

  const isDirty = !!patientId || !!companyId || treatments.length > 0

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

  useEffect(() => {
    if (open && presetPatientId) setPatientId(presetPatientId)
  }, [open, presetPatientId])

  function reset() {
    setPatientId(presetPatientId ?? '')
    setPickedPatient(null)
    setCompanyId('')
    setPolicyNumber('')
    setNotes('')
    setTreatments([])
    setCoverage({})
    setClinicPrices({})
  }

  // Switching insurer invalidates every price already resolved, so clear the
  // lines rather than leave the previous insurer's rates sitting under a new
  // company's name.
  function onCompanyChange(next: string) {
    setCompanyId(next)
    if (treatments.length > 0) {
      setTreatments([])
      setCoverage({})
      setClinicPrices({})
      toast.info('Treatments cleared — re-add them to price against the new insurer')
    }
  }

  const covered = useMemo(
    () => treatments.filter((t) => t.treatmentId && coverage[t.treatmentId] !== false),
    [treatments, coverage]
  )
  const uncovered = useMemo(
    () => treatments.filter((t) => t.treatmentId && coverage[t.treatmentId] === false),
    [treatments, coverage]
  )

  const insurerTotal = covered.reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
  const patientTotal = uncovered.reduce(
    (sum, t) => sum + (clinicPrices[t.treatmentId] ?? Number(t.amount) ?? 0),
    0
  )

  const selectedPatient = presetPatientId ? (presetPatientQuery.data ?? null) : pickedPatient

  useEffect(() => {
    if (selectedPatient) {
      if (selectedPatient.insuranceProvider && selectedPatient.insuranceProvider !== companyId) {
        setCompanyId(selectedPatient.insuranceProvider)
      }
      setPolicyNumber(selectedPatient.insurancePolicyNumber || '')
    }
  }, [selectedPatient?.id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await submit(async () => {
      if (!patientId) {
        toast.error('Select a patient')
        return
      }
      if (!companyId) {
        toast.error('Select an insurance company')
        return
      }
      if (!policyNumber.trim()) {
        toast.error('Enter the patient’s insurance ID')
        return
      }
      if (treatments.length === 0) {
        toast.error('Add at least one treatment')
        return
      }
      if (treatments.some((t) => !t.treatmentId)) {
        toast.error('Every line needs a treatment')
        return
      }
      if (covered.length === 0) {
        toast.error(
          'None of these treatments are in this insurer’s price list — nothing can be claimed'
        )
        return
      }
      // A covered line at 0 usually means the price lookup failed rather than
      // that the insurer pays nothing; the server would reject the whole claim
      // with a vaguer message, so catch it here.
      if (covered.some((t) => !(Number(t.amount) > 0))) {
        toast.error('Every covered treatment needs an amount above 0')
        return
      }

      const lines: InsuranceClaimLineInput[] = treatments.map((t) => {
        const isCovered = coverage[t.treatmentId] !== false
        return {
          serviceId: t.treatmentId,
          description: t.name,
          clinicPrice: clinicPrices[t.treatmentId] ?? Number(t.amount) ?? 0,
          insurerPrice: isCovered ? Number(t.amount) || 0 : 0,
          covered: isCovered,
        }
      })

      // `chargedAmount` is deliberately omitted — the server recomputes it from
      // the covered lines so the client can't decide what the insurer owes.

      // Update patient's insurance details if they changed
      if (
        selectedPatient &&
        (selectedPatient.insuranceProvider !== companyId ||
          selectedPatient.insurancePolicyNumber !== policyNumber.trim())
      ) {
        const up = await updatePatient(patientId, {
          insuranceProvider: companyId,
          insurancePolicyNumber: policyNumber.trim(),
        })
        if (!up.success) {
          surfaceApiError(up, 'Failed to update patient insurance details')
          return
        }
      }

      const res = await createInsuranceClaim({
        companyId,
        patientId,
        notes: notes.trim() || undefined,
        lines,
      })

      if (!res.success) {
        surfaceApiError(res, 'Failed to raise claim')
        return
      }

      const claimNo = res.data?.claimNumber
      toast.success(
        `Claim raised${claimNo ? ` (${claimNo})` : ''} — ${formatCurrency(insurerTotal)} to the insurer`
      )
      if (patientTotal > 0) {
        toast.info(
          `${formatCurrency(patientTotal)} is not covered — collect it from the patient separately.`
        )
      }
      reset()
      onSuccess?.()
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
              <SheetTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Insurance Claim
              </SheetTitle>
              <SheetDescription>
                Raise a claim against the insurer. Treatments price at the insurer&apos;s rates, not
                the clinic&apos;s.
              </SheetDescription>
            </SheetHeader>

            <div className="grid gap-4">
              {presetPatientId ? (
                <div className="space-y-2">
                  <Label>Patient</Label>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    {selectedPatient ? (
                      <>
                        <span className="font-medium">{selectedPatient.name}</span>
                        {selectedPatient.patientId ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {selectedPatient.patientId}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      'Loading patient…'
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="claim-patient">Select Patient *</Label>
                  <PatientPicker
                    id="claim-patient"
                    value={patientId}
                    onChange={(id, patient) => {
                      setPatientId(id)
                      setPickedPatient(patient)
                    }}
                    placeholder="Select a patient"
                    popoverWidthClass="w-[400px]"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="claim-company">Insurance Company *</Label>
                <Select value={companyId} onValueChange={onCompanyChange}>
                  <SelectTrigger id="claim-company">
                    <SelectValue placeholder="Select insurance company" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!isLoadingCompanies && companies.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No insurance companies yet — add one under Insurance → Companies, then set its
                    prices.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="claim-policy-number">Insurance ID *</Label>
                <Input
                  id="claim-policy-number"
                  value={policyNumber}
                  onChange={(e) => setPolicyNumber(e.target.value)}
                  placeholder="Policy or Member ID"
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label>Treatments *</Label>
                {companyId ? (
                  <TreatmentPaymentInput
                    value={treatments}
                    onChange={setTreatments}
                    insuranceCompanyId={companyId}
                    onPriceResolved={(treatmentId, info) => {
                      setCoverage((prev) => ({ ...prev, [treatmentId]: info.covered }))
                      setClinicPrices((prev) => ({ ...prev, [treatmentId]: info.clinicPrice }))
                    }}
                  />
                ) : (
                  <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                    Pick an insurance company first — treatment prices come from their price list.
                  </p>
                )}
              </div>

              {treatments.length > 0 && (
                <div className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Claimed from insurer ({covered.length}{' '}
                      {covered.length === 1 ? 'treatment' : 'treatments'})
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(insurerTotal)}
                    </span>
                  </div>
                  {uncovered.length > 0 && (
                    <div className="flex items-center justify-between border-t pt-1.5">
                      <span className="text-amber-700 dark:text-amber-500">
                        Patient owes (not covered)
                      </span>
                      <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-500">
                        {formatCurrency(patientTotal)}
                      </span>
                    </div>
                  )}
                  {uncovered.length > 0 && (
                    <p className="pt-1 text-xs text-muted-foreground">
                      Uncovered treatments stay on the claim for the record but aren&apos;t billed
                      to the insurer. Collect that amount from the patient as a separate one-time
                      payment.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="claim-notes">Notes (Optional)</Label>
                <Input
                  id="claim-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Reference, authorisation number, …"
                  maxLength={500}
                />
              </div>
            </div>

            <SheetFooter className="mt-6">
              <Button type="button" variant="outline" onClick={requestBack} disabled={isSubmitting}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button type="submit" disabled={isSubmitting || covered.length === 0 || !companyId}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Raise Claim
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  )
}
