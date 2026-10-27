import { Loader2, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  type BlockTimeLike,
  DEFAULT_APPOINTMENT_MINUTES,
  findBlockTimeForAppointment,
} from '@/features/appointments/conflicts'
import {
  invalidateAppointmentPickerCache,
  useAppointmentPickers,
} from '@/features/appointments/hooks/use-appointment-pickers'
import { AddPatientSheet } from '@/features/patients/components/add-patient-sheet'
import { AcceptPaymentSheet } from '@/features/payments/components/accept-payment-sheet'
import { createAppointment } from '@/lib/actions/appointments'
import { getDoctorUnavailability } from '@/lib/actions/doctor-availability'
import { createPendingMedicalRecord } from '@/lib/actions/medical-records'
import { getServices } from '@/lib/actions/services'
import { createWalkIn } from '@/lib/actions/walk-in'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PatientPicker } from '@/shared/components/patient-picker'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Separator } from '@/shared/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/components/ui/sheet'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { formatCurrency } from '@/shared/utils/currency'

type ServiceOption = {
  id: string
  name: string
  category: string
  amount: number
  taxStatus: string
  isActive: boolean
  status: string
}

type WalkInLine = { service: ServiceOption }

interface AddWalkInSheetProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
  onCreated?: () => void
}

export function AddWalkInSheet({
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  trigger,
  onCreated,
}: AddWalkInSheetProps) {
  const isControlled = controlledOpen !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? controlledOpen : internalOpen

  const { isSubmitting, submit } = useSubmitGuard()
  const { doctors, refresh: refreshPickers } = useAppointmentPickers(open)

  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [selectedDoctorId, setSelectedDoctorId] = useState('')
  const [lines, setLines] = useState<WalkInLine[]>([])
  const [notes, setNotes] = useState('')
  // When on, the walk-in routes doctor-first (consult → estimate) instead of
  // billing the catalog now (0168).
  const [requiresEstimate, setRequiresEstimate] = useState(false)

  // Payment — collected via AcceptPaymentSheet after the walk-in is recorded
  const [walkInResult, setWalkInResult] = useState<{
    appointmentId: string
    patientId: string
  } | null>(null)
  const [paymentOpen, setPaymentOpen] = useState(false)

  const [services, setServices] = useState<ServiceOption[]>([])
  const [servicesError, setServicesError] = useState(false)

  // [Medium] Unlike every other booking surface, this one had no client-side
  // block-time check at all — the backend still rejects it, but only after
  // the whole form is filled in and submitted, not live as soon as a doctor
  // is picked. A walk-in has no date/time picker (it's always "right now"),
  // so the check is simply: is this doctor blocked right now?
  const [blockTimes, setBlockTimes] = useState<BlockTimeLike[]>([])
  useEffect(() => {
    if (!open || !selectedDoctorId) {
      setBlockTimes([])
      return
    }
    getDoctorUnavailability(selectedDoctorId).then((r) => {
      setBlockTimes(r.success ? ((r.data as BlockTimeLike[]) ?? []) : [])
    })
  }, [open, selectedDoctorId])

  const blockConflict = useMemo(() => {
    if (!selectedDoctorId) return null
    const now = new Date()
    const end = new Date(now.getTime() + DEFAULT_APPOINTMENT_MINUTES * 60_000)
    return findBlockTimeForAppointment(
      selectedDoctorId,
      now.toISOString(),
      end.toISOString(),
      blockTimes
    )
  }, [selectedDoctorId, blockTimes])

  useEffect(() => {
    if (!open || services.length > 0) return
    let cancelled = false
    // activeOnly = isActive AND approved; `status` alone is the approval column.
    getServices({ activeOnly: true }).then((res) => {
      if (cancelled) return
      if (!res.success) {
        setServicesError(true)
        surfaceApiError(res, 'Could not load the services catalog')
        return
      }
      setServicesError(false)
      const rows = (res.data ?? []) as ServiceOption[]
      setServices(
        rows
          .filter((s) => s.isActive !== false && s.status === 'active')
          // `amount` is numeric(15,2) — the API sends it as a STRING ("1500.00")
          // even though the type says number, because getServices returns any[].
          // Without this the total `reduce` concatenates instead of adding:
          // 1500 + 400 + 17000 + 100 came out as GH₵150,040,017,000,100.
          .map((s) => ({ ...s, amount: Number(s.amount) || 0 }))
          .sort((a, b) => a.name.localeCompare(b.name))
      )
    })
    return () => {
      cancelled = true
    }
  }, [open, services.length])

  const total = lines.reduce((sum, l) => sum + (Number(l.service.amount) || 0), 0)

  const isDirty =
    selectedPatientId !== '' ||
    selectedDoctorId !== '' ||
    lines.length > 0 ||
    notes !== '' ||
    requiresEstimate

  function resetForm() {
    setSelectedPatientId('')
    setSelectedDoctorId('')
    setLines([])
    setNotes('')
    setRequiresEstimate(false)
    // Not the payment hand-off (walkInResult): recording a walk-in sets it and then
    // resets the form in the same render, so clearing it here meant the payment sheet
    // never opened (F39). The payment sheet clears it when it closes.
  }

  function closeAndReset() {
    if (isControlled) setControlledOpen?.(false)
    else setInternalOpen(false)
    resetForm()
  }

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: closeAndReset,
  })

  const setOpen = (next: boolean) => {
    if (next) {
      if (isControlled) setControlledOpen?.(true)
      else setInternalOpen(true)
    } else {
      guardedOnOpenChange(false)
    }
  }

  function addService(serviceId: string) {
    const svc = services.find((s) => s.id === serviceId)
    if (!svc) return
    if (lines.some((l) => l.service.id === serviceId)) return
    setLines((prev) => [...prev, { service: svc }])
  }

  function removeLine(serviceId: string) {
    setLines((prev) => prev.filter((l) => l.service.id !== serviceId))
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedPatientId) {
      toast.error('Please select a patient')
      return
    }
    if (!selectedDoctorId) {
      toast.error('Please select a doctor')
      return
    }
    if (!requiresEstimate && lines.length === 0) {
      toast.error('Please add at least one treatment')
      return
    }
    if (blockConflict) {
      toast.error('Doctor is unavailable during this time')
      return
    }

    void submit(async () => {
      // Requires-estimate walk-in: check the patient in and route to the doctor
      // (no billing now). The doctor prices via the estimate; reception confirms.
      if (requiresEstimate) {
        const res = await createAppointment(
          {
            patientId: selectedPatientId,
            doctorId: selectedDoctorId,
            date: new Date(),
            type: 'consultation',
            status: 'checked_in',
            notes: notes.trim() || null,
            requiresEstimate: true,
          } as Parameters<typeof createAppointment>[0],
          false
        )
        if (!res.success) {
          surfaceApiError(res, 'Failed to check in walk-in')
          return
        }
        const appt = res.data as { id?: string } | undefined
        try {
          if (appt?.id) {
            await createPendingMedicalRecord({
              patientId: selectedPatientId,
              doctorId: selectedDoctorId,
              appointmentId: appt.id,
            })
          }
        } catch {
          // non-fatal
        }
        toast.success('Checked in — sent to the doctor for an estimate.')
        closeAndReset()
        onCreated?.()
        return
      }

      const res = await createWalkIn({
        patientId: selectedPatientId,
        appointment: { doctorId: selectedDoctorId, notes: notes.trim() || null },
        lines: lines.map((l) => ({ serviceId: l.service.id, quantity: 1 })),
      })

      if (!res.success) {
        surfaceApiError(res, 'Failed to record walk-in')
        return
      }

      const data = res.data

      try {
        if (data?.appointment?.id) {
          await createPendingMedicalRecord({
            patientId: selectedPatientId,
            doctorId: selectedDoctorId,
            appointmentId: data.appointment.id,
          })
        }
      } catch {
        // non-fatal
      }

      toast.success('Walk-in recorded.')

      // Open payment dialog for this appointment/patient
      if (data?.appointment?.id) {
        setWalkInResult({ appointmentId: data.appointment.id, patientId: selectedPatientId })
        setPaymentOpen(true)
      }

      closeAndReset()
      onCreated?.()
    })
  }

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
        <SheetContent className="!w-full !max-w-[560px] overflow-y-auto">
          <form onSubmit={onSubmit}>
            <SheetHeader className="mb-6">
              <SheetTitle>New Walk-in</SheetTitle>
              <SheetDescription>
                Check in a walk-in patient, bill the treatments from the catalog, and collect
                payment — all in one step.
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 pb-6">
              {/* Patient */}
              <div className="space-y-1.5">
                <Label htmlFor="walk-in-patient">Patient</Label>
                <PatientPicker
                  id="walk-in-patient"
                  value={selectedPatientId}
                  onChange={(id) => setSelectedPatientId(id)}
                />
                <div className="flex items-center gap-2 pt-0.5">
                  <AddPatientSheet
                    onCreated={async (newId) => {
                      invalidateAppointmentPickerCache()
                      await refreshPickers()
                      if (newId) {
                        setSelectedPatientId(newId)
                      }
                    }}
                    trigger={
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        New patient
                      </button>
                    }
                  />
                </div>
              </div>

              {/* Doctor */}
              <div className="space-y-1.5">
                <Label htmlFor="walk-in-doctor">Doctor</Label>
                <Select value={selectedDoctorId} onValueChange={setSelectedDoctorId}>
                  <SelectTrigger id="walk-in-doctor">
                    <SelectValue placeholder="Select doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    {doctors.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.user?.name ?? 'Unknown doctor'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {blockConflict && (
                  <p className="text-xs text-destructive" role="alert">
                    {doctors.find((d) => d.id === selectedDoctorId)?.user?.name ?? 'Doctor'} is
                    unavailable right now
                    {blockConflict.reason ? ` — ${blockConflict.reason}.` : '.'}
                  </p>
                )}
              </div>

              {/* Requires-estimate routing (0168) */}
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 hover:bg-muted/40">
                <Checkbox
                  checked={requiresEstimate}
                  onCheckedChange={(v) => setRequiresEstimate(v === true)}
                />
                <div>
                  <p className="text-sm font-medium">Requires estimate (doctor prices first)</p>
                  <p className="text-xs text-muted-foreground">
                    Check in now; the doctor creates the estimate and reception confirms &amp; takes
                    payment.
                  </p>
                </div>
              </label>

              {!requiresEstimate && (
                <>
                  <Separator />

                  {/* Treatments */}
                  <div className="space-y-2">
                    <Label id="walk-in-treatments-label">Treatments</Label>
                    <Select value="" onValueChange={addService}>
                      <SelectTrigger aria-labelledby="walk-in-treatments-label">
                        <SelectValue placeholder="Add a treatment from the catalog…" />
                      </SelectTrigger>
                      <SelectContent>
                        {services.length === 0 ? (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            {servicesError
                              ? "Couldn't load services — close and reopen to retry"
                              : 'No active services found'}
                          </div>
                        ) : (
                          services.map((s) => (
                            <SelectItem
                              key={s.id}
                              value={s.id}
                              disabled={lines.some((l) => l.service.id === s.id)}
                            >
                              {s.name} · {formatCurrency(s.amount)}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>

                    {lines.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No treatments added yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {lines.map((l) => (
                          <div
                            key={l.service.id}
                            className="flex items-center gap-2 rounded-lg border p-2"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{l.service.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatCurrency(l.service.amount)}
                                {l.service.taxStatus === 'standard' ? ' · taxable' : ''}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground"
                              onClick={() => removeLine(l.service.id)}
                              aria-label={`Remove ${l.service.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    {lines.length > 0 && (
                      <div className="flex justify-end rounded-lg bg-muted/40 p-3">
                        <span className="text-sm font-semibold">
                          Total: {formatCurrency(total)}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}

              <Separator />

              {/* Notes */}
              <div className="space-y-1.5">
                <Label htmlFor="walk-in-notes">Notes (optional)</Label>
                <Textarea
                  id="walk-in-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Visit notes…"
                  maxLength={500}
                />
              </div>
            </div>

            <SheetFooter>
              <Button
                type="submit"
                disabled={isSubmitting || blockConflict !== null}
                className="w-full"
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {requiresEstimate ? 'Check in for estimate' : 'Record walk-in'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
        <ConfirmDiscardDialog
          open={confirmOpen}
          onConfirm={confirmDiscard}
          onCancel={cancelDiscard}
        />
      </Sheet>

      {/* Payment collection — opens after the walk-in is recorded */}
      {walkInResult && (
        <AcceptPaymentSheet
          open={paymentOpen}
          onOpenChange={(v) => {
            setPaymentOpen(v)
            if (!v) setWalkInResult(null)
          }}
          presetPatientId={walkInResult.patientId}
          // Name the visit on the payment. Not `appointmentId`: that pays THROUGH check-in,
          // which refuses a walk-in (already checked in) and takes no money (F33).
          linkAppointmentId={walkInResult.appointmentId}
          onSuccess={() => {
            setPaymentOpen(false)
            setWalkInResult(null)
            onCreated?.()
          }}
        />
      )}
    </>
  )
}
