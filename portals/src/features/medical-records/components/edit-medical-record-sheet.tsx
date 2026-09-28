import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { MedicalRecord } from '@/features/medical-records/pages/columns'
import { getDoctors } from '@/lib/actions/doctors'
import { updateMedicalRecord } from '@/lib/actions/medical-records'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
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
import { parseLocalDate } from '@/shared/lib/dates'
import { ImageUpload } from './image-upload'

interface EditMedicalRecordSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: MedicalRecord
  onSuccess?: () => void
}

function parseAttachments(attachments: unknown): string[] {
  if (!attachments || typeof attachments !== 'string') return []
  try {
    const parsed = JSON.parse(attachments)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function EditMedicalRecordSheet(props: EditMedicalRecordSheetProps) {
  // Conditionally *rendering* a component is fine; conditionally *calling* hooks is
  // not. The missing-record guard therefore lives here, and every hook lives in the
  // inner form component below where it always runs.
  if (!props.record) return null
  return <EditMedicalRecordSheetForm {...props} />
}

function EditMedicalRecordSheetForm({
  open,
  onOpenChange,
  record,
  onSuccess,
}: EditMedicalRecordSheetProps) {
  const _navigate = useNavigate()
  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()

  const doctorsQuery = useApiQuery<Array<{ id: string; user: { name: string } | null }>>(
    queryKeys.doctors.list(),
    () => getDoctors(),
    { enabled: open }
  )
  const doctorsList = doctorsQuery.data ?? []

  // Initial values derived from the record prop
  const initialDoctorId = (record.doctorId as string) || ''
  const initialComplaint = (record.complaint as string) || ''
  const initialExamination = (record.examination as string) || ''
  const initialDiagnosis = (record.diagnosis as string) || ''
  const initialTreatment = (record.treatment as string) || ''
  const initialPrescription = (record.prescription as string) || ''
  const initialNotes = (record.notes as string) || ''
  const initialImages = useMemo(() => parseAttachments(record.attachments), [record.attachments])

  const [doctorId, setDoctorId] = useState(initialDoctorId)
  const [complaint, setComplaint] = useState(initialComplaint)
  const [examination, setExamination] = useState(initialExamination)
  const [diagnosis, setDiagnosis] = useState(initialDiagnosis)
  const [treatment, setTreatment] = useState(initialTreatment)
  const [prescription, setPrescription] = useState(initialPrescription)
  const [notes, setNotes] = useState(initialNotes)
  const [images, setImages] = useState<string[]>(initialImages)

  // Reset when record changes or sheet reopens
  useEffect(() => {
    if (!open) return
    setDoctorId((record.doctorId as string) || '')
    setComplaint((record.complaint as string) || '')
    setExamination((record.examination as string) || '')
    setDiagnosis((record.diagnosis as string) || '')
    setTreatment((record.treatment as string) || '')
    setPrescription((record.prescription as string) || '')
    setNotes((record.notes as string) || '')
    setImages(parseAttachments(record.attachments))
    setStatusMessage(undefined)
  }, [record, open])

  const recordPatient = (record.patient ?? null) as {
    name?: string | null
    createdAt?: string | Date | null
  } | null

  const patientName = recordPatient?.name ?? 'patient'
  // Extract the date-only portion from the ISO string before parsing to avoid
  // UTC-vs-local drift: `new Date(isoString)` parses as UTC but ImageUpload
  // uses local-time accessors (.getDate()/.getMonth()/.getFullYear()), which
  // shifts the computed folder name by a day for clients outside UTC.
  const patientCreatedDate = useMemo(() => {
    const raw = recordPatient?.createdAt ?? record.createdAt
    if (typeof raw === 'string' && raw.length >= 10) {
      return parseLocalDate(raw.slice(0, 10))
    }
    if (raw instanceof Date) {
      return parseLocalDate(raw.toISOString().slice(0, 10))
    }
    return new Date()
  }, [recordPatient?.createdAt, record.createdAt])

  const imagesChanged = useMemo(() => {
    if (images.length !== initialImages.length) return true
    return images.some((img, idx) => img !== initialImages[idx])
  }, [images, initialImages])

  const isDirty = useMemo(() => {
    return (
      doctorId !== ((record.doctorId as string) || '') ||
      complaint !== ((record.complaint as string) || '') ||
      examination !== ((record.examination as string) || '') ||
      diagnosis !== ((record.diagnosis as string) || '') ||
      treatment !== ((record.treatment as string) || '') ||
      prescription !== ((record.prescription as string) || '') ||
      notes !== ((record.notes as string) || '') ||
      imagesChanged
    )
  }, [
    record,
    doctorId,
    complaint,
    examination,
    diagnosis,
    treatment,
    prescription,
    notes,
    imagesChanged,
  ])

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => onOpenChange(false),
  })

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  // Pre-empt useApiMutation's generic error so a backend zod issue still
  // surfaces via `apiErrorMessage` (field + message), matching the
  // surfaceApiError() call this replaces.
  const updateMutation = useApiMutation(
    async (data: Parameters<typeof updateMedicalRecord>[1]) => {
      const res = await updateMedicalRecord(record.id, data)
      if (!res.success) throw new Error(apiErrorMessage(res))
      return res
    },
    {
      invalidates: [queryKeys.medicalRecords.list(), queryKeys.medicalRecords.detail(record.id)],
    }
  )

  function handleSubmit() {
    setStatusMessage(undefined)

    if (!doctorId || !UUID_RE.test(doctorId)) {
      toast.error('Please select a valid doctor')
      return
    }

    void submit(async () => {
      const data = {
        doctorId,
        complaint: complaint || null,
        examination: examination || null,
        diagnosis: diagnosis || null,
        treatment: treatment || null,
        prescription: prescription || null,
        notes: notes || null,
        attachments: images.length > 0 ? JSON.stringify(images) : null,
      }

      try {
        await updateMutation.mutateAsync(data)
        toast.success('Medical record updated successfully.')
        onOpenChange(false)
        if (onSuccess) onSuccess()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong.'
        setStatusMessage(message)
        toast.error(message)
      }
    })
  }

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Edit Medical Record"
        description="Update patient consultation and treatment details."
        size="lg"
        submitLabel="Update Record"
        submitting={isSubmitting}
        submitDisabled={!isDirty || isSubmitting}
        onSubmit={handleSubmit}
        statusMessage={statusMessage}
      >
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="edit-doctorId">Doctor</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger id="edit-doctorId">
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-complaint">Chief Complaint</Label>
            <Textarea
              id="edit-complaint"
              value={complaint}
              onChange={(e) => setComplaint(e.target.value)}
              placeholder="Reason for visit"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-examination">Examination</Label>
            <Textarea
              id="edit-examination"
              value={examination}
              onChange={(e) => setExamination(e.target.value)}
              placeholder="Physical/Clinical findings"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-diagnosis">Diagnosis</Label>
            <Textarea
              id="edit-diagnosis"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="Assessment/Diagnosis"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-treatment">Treatment Plan</Label>
            <Textarea
              id="edit-treatment"
              value={treatment}
              onChange={(e) => setTreatment(e.target.value)}
              placeholder="Proposed treatment"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-prescription">Prescription</Label>
            <Textarea
              id="edit-prescription"
              value={prescription}
              onChange={(e) => setPrescription(e.target.value)}
              placeholder="Prescriptions prescribed"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-notes">Additional Notes</Label>
            <Textarea
              id="edit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Other relevant information"
            />
          </div>

          <div className="space-y-2">
            <Label>Images</Label>
            <ImageUpload
              images={images}
              onChange={setImages}
              maxImages={10}
              maxSize={5 * 1024 * 1024}
              patientName={patientName}
              patientCreatedDate={patientCreatedDate}
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
