import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PatientPicker } from '@/shared/components/patient-picker'
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
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { inputToCents } from '@/shared/utils/currency'
import type { InsuranceCompany } from '../types'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  companies: InsuranceCompany[]
  onSaved: () => void
}

type Patient = {
  id: string
  name: string
  patientId: string | null
  phone: string | null
}

type MedicalRecord = {
  id: string
  date: string
  diagnosis: string | null
  treatment: string | null
}

/**
 * "New reconciliation entry" form, migrated from the legacy modal Dialog to
 * the standard `<SheetFormLayout>` slide-over (M6 dialog->sheet pass).
 *
 * Treatment selection (M6.3): the user must pick one of the patient's recent
 * medical records (last 60 days). Free-form treatment text is intentionally
 * not allowed — we want every reconciliation row tied back to a documented
 * encounter so audits can trace claim -> chart entry.
 */
export function NewReconciliationSheet({ open, onOpenChange, companies, onSaved }: Props) {
  const [companyId, setCompanyId] = useState<string>('')
  const [cardNumber, setCardNumber] = useState('')
  const [patientId, setPatientId] = useState<string>('')
  const [patientSearch, setPatientSearch] = useState('')
  const [patients, setPatients] = useState<Patient[]>([])
  const [records, setRecords] = useState<MedicalRecord[]>([])
  const [treatmentSourceId, setTreatmentSourceId] = useState<string>('')
  const [chargedAmount, setChargedAmount] = useState('')
  const [notes, setNotes] = useState('')

  const { isSubmitting, submit } = useSubmitGuard()

  const isDirty = !!(
    companyId ||
    cardNumber ||
    patientId ||
    treatmentSourceId ||
    chargedAmount ||
    notes
  )
  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  // Reset on close so reopening starts clean.
  useEffect(() => {
    if (!open) {
      setCompanyId('')
      setCardNumber('')
      setPatientId('')
      setPatientSearch('')
      setRecords([])
      setTreatmentSourceId('')
      setChargedAmount('')
      setNotes('')
    }
  }, [open])

  // Debounced patient search — fires only while the sheet is open.
  // AbortController cancels any in-flight request when the query changes,
  // preventing stale responses from overwriting the current results.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      const qs = patientSearch ? `?search=${encodeURIComponent(patientSearch)}` : ''
      const res = await api.get<Patient[]>(`/api/patients${qs}`, { signal: controller.signal })
      if (res.success && res.data) setPatients(res.data.slice(0, 20))
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [patientSearch, open])

  // Pull patient's last-60-days medical records for the treatment Select.
  useEffect(() => {
    if (!patientId) {
      setRecords([])
      return
    }
    ;(async () => {
      const res = await api.get<MedicalRecord[]>(`/api/medical-records?patientId=${patientId}`)
      if (res.success && res.data) {
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 60)
        const filtered = res.data
          .filter((r) => {
            try {
              return new Date(r.date) >= cutoff
            } catch {
              console.warn('[NewReconciliationSheet] Malformed record date:', r.id, r.date)
              return false
            }
          })
          .sort((a, b) => (a.date < b.date ? 1 : -1))
        setRecords(filtered)
      }
    })()
  }, [patientId])

  function handleSubmit() {
    if (!companyId) {
      toast.error('Select a company')
      return
    }
    if (!cardNumber.trim()) {
      toast.error('Card number required')
      return
    }
    if (!patientId) {
      toast.error('Select a patient')
      return
    }
    if (!treatmentSourceId) {
      toast.error('Select a treatment or add one')
      return
    }
    const cents = inputToCents(chargedAmount)
    if (cents <= 0) {
      toast.error('Invalid amount')
      return
    }

    void submit(async () => {
      const res = await api.post('/api/insurance/reconciliation', {
        companyId,
        patientId,
        cardNumber: cardNumber.trim(),
        treatmentSourceType: 'medical_record',
        treatmentSourceId,
        chargedAmount: cents,
        notes: notes || null,
      })
      if (res.success) {
        toast.success('Reconciliation entry saved')
        onOpenChange(false)
        onSaved()
      } else {
        surfaceApiError(res, 'Failed to save')
      }
    })
  }

  const selectedPatient = patients.find((p) => p.id === patientId)

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="New Reconciliation Entry"
        description="Tie an insurance-funded treatment to its insurer card and charged amount."
        size="md"
        submitLabel="Save Entry"
        submitting={isSubmitting}
        onSubmit={handleSubmit}
      >
        <div className="space-y-3">
          {/* Company */}
          <div className="space-y-1.5">
            <Label htmlFor="reconciliation-company">Insurance Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger id="reconciliation-company">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies
                  .filter((c) => c.active)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Card number */}
          <div className="space-y-1.5">
            <Label htmlFor="reconciliation-card">Card / Policy Number</Label>
            <Input
              id="reconciliation-card"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="Policy ID as on insurer card"
              maxLength={100}
            />
          </div>

          {/* Patient — shared PatientPicker (same UX as the New Appointment
              sheet). Falls back to its own cached fetch if `patients` is
              empty (e.g. before the search-debounced load has fired). */}
          <div className="space-y-1.5">
            <Label htmlFor="reconciliation-patient">Patient</Label>
            <PatientPicker
              id="reconciliation-patient"
              value={patientId}
              onChange={(id) => setPatientId(id)}
              patients={patients.length > 0 ? patients : undefined}
            />
          </div>

          {/* Treatment selection (M6.3) */}
          {patientId && (
            <div className="space-y-1.5">
              <Label htmlFor="reconciliation-treatment">Treatment</Label>
              {records.length === 0 ? (
                <div className="space-y-2 rounded-md border border-dashed border-border p-3 text-center">
                  <p className="text-xs text-muted-foreground">
                    No recent treatments found for this patient.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Open the patient record and add a treatment first, then return here.
                  </p>
                  {selectedPatient && (
                    <Button size="sm" variant="outline" asChild>
                      <a
                        href={`/patients/${selectedPatient.id}?tab=medical`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open Patient Record
                      </a>
                    </Button>
                  )}
                </div>
              ) : (
                <Select value={treatmentSourceId} onValueChange={setTreatmentSourceId}>
                  <SelectTrigger id="reconciliation-treatment">
                    <SelectValue placeholder="Select recent treatment" />
                  </SelectTrigger>
                  <SelectContent>
                    {records.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        <span className="truncate">
                          {(() => {
                            try {
                              return format(new Date(r.date), 'MMM d')
                            } catch {
                              return '—'
                            }
                          })()}
                          {' — '}
                          {r.treatment || r.diagnosis || 'Record'}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="reconciliation-amount">Amount charged in insurer's system (GHS)</Label>
            <Input
              id="reconciliation-amount"
              type="number"
              step="0.01"
              min={0.01}
              value={chargedAmount}
              onChange={(e) => setChargedAmount(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="reconciliation-notes">Notes (optional)</Label>
            <Textarea
              id="reconciliation-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={1000}
            />
          </div>
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
