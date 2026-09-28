import { Plus } from 'lucide-react'
import { useLayoutEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getDoctors } from '@/lib/actions/doctors'
import { createMedicalRecord } from '@/lib/actions/medical-records'
import { getPatient } from '@/lib/actions/patients'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PatientPicker, type PickerPatient } from '@/shared/components/patient-picker'
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
import { apiErrorMessage } from '@/shared/lib/api-error'
import { ImageUpload } from './image-upload'

interface AddMedicalRecordSheetProps {
  currentDoctorId?: string
  currentDoctorName?: string
  isDoctor?: boolean
  defaultPatientId?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Add-medical-record form as a right-side Sheet. Migrated from
 * `add-medical-record-dialog.tsx` per the UX restructure plan.
 *
 * Supports both controlled (`open`/`onOpenChange` provided) and self-contained
 * (renders its own trigger button) usage — matches the old dialog's API so
 * callers only change the import/name.
 */
export function AddMedicalRecordSheet({
  currentDoctorId,
  currentDoctorName,
  isDoctor = false,
  defaultPatientId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AddMedicalRecordSheetProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setOpen = controlledOnOpenChange !== undefined ? controlledOnOpenChange : setInternalOpen
  const isControlled = controlledOpen !== undefined

  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()

  const doctorsQuery = useApiQuery<Array<{ id: string; user?: { name: string } }>>(
    queryKeys.doctors.list(),
    () => getDoctors(),
    { enabled: open }
  )
  const doctorsList = doctorsQuery.data ?? []
  const isLoadingDoctors = doctorsQuery.isFetching

  // Pre-empt useApiMutation's generic error so a backend zod issue still
  // surfaces via `apiErrorMessage` (field + message), matching the
  // surfaceApiError() call this replaces.
  const createMutation = useApiMutation(
    async (data: Parameters<typeof createMedicalRecord>[0]) => {
      const res = await createMedicalRecord(data)
      if (!res.success) throw new Error(apiErrorMessage(res))
      return res
    },
    { invalidates: [queryKeys.medicalRecords.list()] }
  )

  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(
    isDoctor && currentDoctorId ? currentDoctorId : ''
  )
  const [selectedPatientId, setSelectedPatientId] = useState<string>(defaultPatientId || '')
  // Resolves the full row for `defaultPatientId` (the picker's onChange only
  // fires on user interaction, not for a programmatically-set value); once
  // the user actively picks someone else, that takes over via `pickedPatient`.
  const defaultPatientQuery = useApiQuery(
    queryKeys.patients.detail(defaultPatientId ?? ''),
    async () =>
      defaultPatientId ? getPatient(defaultPatientId) : { success: true as const, data: null },
    { enabled: !!defaultPatientId }
  )
  const [pickedPatient, setPickedPatient] = useState<PickerPatient | null>(null)
  const [complaint, setComplaint] = useState('')
  const [examination, setExamination] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [treatment, setTreatment] = useState('')
  const [prescription, setPrescription] = useState('')
  const [notes, setNotes] = useState('')
  const [images, setImages] = useState<string[]>([])

  const selectedPatient = pickedPatient ?? defaultPatientQuery.data ?? null

  // Sync selectedDoctorId when currentDoctorId changes
  useLayoutEffect(() => {
    if (isDoctor && currentDoctorId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedDoctorId(currentDoctorId)
    }
  }, [isDoctor, currentDoctorId])

  // Sync selectedPatientId when defaultPatientId changes
  useLayoutEffect(() => {
    if (defaultPatientId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedPatientId(defaultPatientId)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPickedPatient(null)
    }
  }, [defaultPatientId])

  const isDirty = useMemo(() => {
    const initialDoctorId = isDoctor && currentDoctorId ? currentDoctorId : ''
    const initialPatientId = defaultPatientId || ''
    return (
      selectedDoctorId !== initialDoctorId ||
      selectedPatientId !== initialPatientId ||
      complaint !== '' ||
      examination !== '' ||
      diagnosis !== '' ||
      treatment !== '' ||
      prescription !== '' ||
      notes !== '' ||
      images.length > 0
    )
  }, [
    isDoctor,
    currentDoctorId,
    defaultPatientId,
    selectedDoctorId,
    selectedPatientId,
    complaint,
    examination,
    diagnosis,
    treatment,
    prescription,
    notes,
    images,
  ])

  function resetForm() {
    setSelectedDoctorId(isDoctor && currentDoctorId ? currentDoctorId : '')
    setSelectedPatientId(defaultPatientId || '')
    setComplaint('')
    setExamination('')
    setDiagnosis('')
    setTreatment('')
    setPrescription('')
    setNotes('')
    setImages([])
    setStatusMessage(undefined)
  }

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => {
      setOpen(false)
      resetForm()
    },
  })

  function handleSubmit() {
    setStatusMessage(undefined)

    if (!selectedPatientId) {
      toast.error('Please select a patient')
      return
    }
    if (!selectedDoctorId) {
      toast.error('Please select a doctor')
      return
    }
    if (!complaint || complaint.trim() === '') {
      toast.error('Chief complaint is required')
      return
    }

    void submit(async () => {
      const data = {
        patientId: selectedPatientId,
        doctorId: selectedDoctorId,
        complaint,
        examination,
        diagnosis,
        treatment,
        prescription,
        notes,
        attachments: images.length > 0 ? JSON.stringify(images) : null,
      }

      try {
        await createMutation.mutateAsync(data)
        toast.success('Medical record created successfully.')
        setOpen(false)
        resetForm()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong.'
        setStatusMessage(message)
        toast.error(message)
      }
    })
  }

  return (
    <>
      {!isControlled && (
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Medical Record
        </Button>
      )}

      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="New Medical Record"
        description="Record patient consultation and treatment details."
        size="lg"
        submitLabel="Save Record"
        submitting={isSubmitting}
        submitDisabled={!isDirty || !selectedPatientId || !selectedDoctorId || !complaint.trim()}
        onSubmit={handleSubmit}
        statusMessage={statusMessage}
      >
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="patientId">Patient</Label>
              <PatientPicker
                id="patientId"
                value={selectedPatientId}
                onChange={(id, patient) => {
                  setSelectedPatientId(id)
                  setPickedPatient(patient)
                }}
                placeholder="Select patient"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doctorId">
                Doctor
                {isDoctor && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    (Auto-assigned)
                  </span>
                )}
              </Label>
              {isLoadingDoctors ? (
                <div className="h-10 flex items-center px-3 border rounded-md bg-muted">
                  <span className="text-sm text-muted-foreground">Loading doctors...</span>
                </div>
              ) : isDoctor ? (
                <Input
                  id="doctorId"
                  type="text"
                  value={currentDoctorName || ''}
                  disabled
                  aria-required="true"
                  className="bg-muted cursor-not-allowed"
                />
              ) : (
                <Select value={selectedDoctorId || undefined} onValueChange={setSelectedDoctorId}>
                  <SelectTrigger id="doctorId" aria-required="true">
                    <SelectValue placeholder="Select doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    {doctorsList.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.user?.name || 'Unknown'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {isDoctor && (
                <p className="text-xs text-muted-foreground">
                  This record will be created under your name
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="complaint">Chief Complaint</Label>
            <Textarea
              id="complaint"
              value={complaint}
              onChange={(e) => setComplaint(e.target.value)}
              placeholder="Reason for visit"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="examination">Examination</Label>
            <Textarea
              id="examination"
              value={examination}
              onChange={(e) => setExamination(e.target.value)}
              placeholder="Physical/Clinical findings"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="diagnosis">Diagnosis</Label>
            <Textarea
              id="diagnosis"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="Assessment/Diagnosis"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="treatment">Treatment Plan</Label>
            <Textarea
              id="treatment"
              value={treatment}
              onChange={(e) => setTreatment(e.target.value)}
              placeholder="Proposed treatment"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="prescription">Prescription</Label>
            <Textarea
              id="prescription"
              value={prescription}
              onChange={(e) => setPrescription(e.target.value)}
              placeholder="Prescriptions prescribed"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Other relevant information"
            />
          </div>

          <div className="space-y-2">
            <Label>Images</Label>
            {selectedPatient ? (
              <ImageUpload
                images={images}
                onChange={setImages}
                maxImages={10}
                maxSize={5 * 1024 * 1024}
                patientName={selectedPatient.name}
                patientCreatedDate={new Date(selectedPatient.createdAt ?? Date.now())}
              />
            ) : (
              <div className="text-sm text-muted-foreground p-4 border border-dashed rounded-lg text-center">
                Please select a patient first
              </div>
            )}
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
