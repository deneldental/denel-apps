import { FileImage, Upload, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { uploadFile } from '@/lib/actions/upload'
import { api } from '@/lib/api-client'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
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
import { localDateISO, parseLocalDate } from '@/shared/lib/dates'

interface AddXraySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

type Patient = { id: string; name: string; patientId: string | null }
type XrayType = { id: string; name: string; displayName: string; active: boolean }
type Doctor = { id: string; name: string }

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp']
const MAX_FILE_BYTES = 20 * 1024 * 1024 // 20 MB

export function AddXraySheet({ open, onOpenChange, onSaved }: AddXraySheetProps) {
  const [patientId, setPatientId] = useState('')
  const [patientSearch, setPatientSearch] = useState('')
  const [debouncedPatientSearch, setDebouncedPatientSearch] = useState('')
  const [selectedPatientName, setSelectedPatientName] = useState('')

  const [typeId, setTypeId] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [notes, setNotes] = useState('')
  const [capturedAt, setCapturedAt] = useState(() => localDateISO())
  const [file, setFile] = useState<File | null>(null)

  const { isSubmitting, submit } = useSubmitGuard()

  const isDirty = !!patientId || !!file || !!typeId || notes.trim().length > 0
  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  const xrayTypesQuery = useApiQuery<XrayType[]>(
    queryKeys.xrays.types(),
    () => api.get<XrayType[]>('/api/xrays/types'),
    { enabled: open, select: (rows) => rows.filter((t) => t.active) }
  )
  const xrayTypes = xrayTypesQuery.data ?? []

  const doctorsQuery = useApiQuery<Doctor[]>(
    queryKeys.doctors.list(),
    () => api.get<Doctor[]>('/api/doctors'),
    { enabled: open }
  )
  const doctors = doctorsQuery.data ?? []

  // Reset the form when the sheet closes.
  useEffect(() => {
    if (open) return
    setPatientId('')
    setPatientSearch('')
    setDebouncedPatientSearch('')
    setSelectedPatientName('')
    setTypeId('')
    setDoctorId('')
    setNotes('')
    setCapturedAt(localDateISO())
    setFile(null)
  }, [open])

  // Debounce the patient search box so it doesn't fire a lookup per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPatientSearch(patientSearch), 200)
    return () => clearTimeout(t)
  }, [patientSearch])

  const patientSearchQuery = useApiQuery<Patient[]>(
    queryKeys.patients.list({ search: debouncedPatientSearch }),
    () => api.get<Patient[]>(`/api/patients?search=${encodeURIComponent(debouncedPatientSearch)}`),
    { enabled: open && debouncedPatientSearch.length > 0 }
  )
  const patients = (patientSearchQuery.data ?? []).slice(0, 20)

  // Pre-empt useApiMutation's generic error so a backend zod issue still
  // surfaces via `apiErrorMessage` (field + message), matching the
  // surfaceApiError() call this replaces.
  const saveMutation = useApiMutation(
    async (payload: Record<string, unknown>) => {
      const res = await api.post('/api/xrays', payload)
      if (!res.success) throw new Error(apiErrorMessage(res, 'Failed to save'))
      return res
    },
    { invalidates: [queryKeys.xrays.patient(patientId), queryKeys.xrays.list()] }
  )

  function handleSubmit() {
    if (!patientId) {
      toast.error('Select a patient')
      return
    }
    if (!file) {
      toast.error('Choose an image file')
      return
    }
    // Client-side MIME + size guard (the accept attribute can be bypassed)
    if (!ALLOWED_MIME.includes(file.type)) {
      toast.error('Only PNG, JPG, or WebP images are accepted')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error('Image must be smaller than 20 MB')
      return
    }

    void submit(async () => {
      const up = await uploadFile(file, {
        storageCategory: 'patient_records',
        folder: 'xrays',
        subfolder: patientId,
        profile: 'image',
      })
      if (!up.success || !up.url) {
        toast.error(up.error || 'Upload failed')
        // Clear the file so the UI unambiguously reflects the upload did not succeed
        setFile(null)
        return
      }

      try {
        await saveMutation.mutateAsync({
          patientId,
          xrayTypeId: typeId || null,
          imageUrl: up.url,
          origin: 'internal',
          // parseLocalDate avoids the UTC midnight off-by-one for users west of UTC
          capturedAt: capturedAt ? parseLocalDate(capturedAt).toISOString() : null,
          notes:
            [
              notes.trim(),
              doctorId ? `Doctor: ${doctors.find((d) => d.id === doctorId)?.name || doctorId}` : '',
            ]
              .filter(Boolean)
              .join('\n') || null,
        })
        toast.success('X-ray saved')
        onSaved?.()
        onOpenChange(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save')
      }
    })
  }

  const showDropdown = !patientId && patients.length > 0 && patientSearch.length > 0

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Add X-ray"
        description="Attach an X-ray image to a patient record."
        size="md"
        submitLabel="Save X-ray"
        submitting={isSubmitting}
        submitDisabled={!patientId || !file}
        onSubmit={handleSubmit}
      >
        <div className="grid gap-5">
          {/* Patient */}
          <div className="space-y-2">
            <Label htmlFor="xray-patient">Patient *</Label>
            <Input
              id="xray-patient"
              value={patientId ? selectedPatientName : patientSearch}
              onChange={(e) => {
                setPatientSearch(e.target.value)
                if (patientId) {
                  setPatientId('')
                  setSelectedPatientName('')
                }
              }}
              placeholder="Search patient…"
            />
            {showDropdown && (
              <div className="rounded-md border border-border bg-popover shadow-sm max-h-40 overflow-y-auto">
                {patients.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full text-left px-3 py-1.5 hover:bg-muted text-sm"
                    onClick={() => {
                      setPatientId(p.id)
                      setSelectedPatientName(p.name)
                      setPatientSearch('')
                      setDebouncedPatientSearch('')
                    }}
                  >
                    {p.name}
                    {p.patientId && (
                      <span className="ml-2 text-xs text-muted-foreground">{p.patientId}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* X-ray type */}
          <div className="space-y-2">
            <Label htmlFor="xray-type">X-ray type</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger id="xray-type">
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
              <SelectContent>
                {xrayTypes.length === 0 ? (
                  <SelectItem value="_none" disabled>
                    No types configured
                  </SelectItem>
                ) : (
                  xrayTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.displayName}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Doctor */}
          <div className="space-y-2">
            <Label htmlFor="xray-doctor">Taken by</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger id="xray-doctor">
                <SelectValue placeholder="Select doctor" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Capture date */}
          <div className="space-y-2">
            <Label htmlFor="xray-date">Captured on</Label>
            <Input
              id="xray-date"
              type="date"
              value={capturedAt}
              onChange={(e) => setCapturedAt(e.target.value)}
            />
          </div>

          {/* File */}
          <div className="space-y-2">
            <Label htmlFor="xray-file">Image *</Label>
            <label
              htmlFor="xray-file"
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 transition-colors ${
                file
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border hover:border-muted-foreground/50'
              }`}
            >
              <input
                id="xray-file"
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <div className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 max-w-full">
                  <FileImage className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      setFile(null)
                    }}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Remove file"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="h-7 w-7 text-muted-foreground/60" />
                  <div className="space-y-0.5 text-center">
                    <p className="text-sm font-medium">Drop an X-ray image here</p>
                    <p className="text-xs text-muted-foreground">or click to browse — PNG or JPG</p>
                  </div>
                </>
              )}
            </label>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="xray-notes">Notes</Label>
            <Textarea
              id="xray-notes"
              rows={3}
              placeholder="Optional — clinical observations, region of interest, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
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
