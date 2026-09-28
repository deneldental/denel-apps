import { Loader2, Plus } from 'lucide-react'
import type React from 'react'
import { useEffect, useLayoutEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getDoctors } from '@/lib/actions/doctors'
import { createMedicalRecord } from '@/lib/actions/medical-records'
import { getPatients } from '@/lib/actions/patients'
import { ImageUpload } from './image-upload'

interface AddMedicalRecordDialogProps {
  currentDoctorId?: string
  currentDoctorName?: string
  isDoctor?: boolean
  defaultPatientId?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function AddMedicalRecordDialog({
  currentDoctorId,
  currentDoctorName,
  isDoctor = false,
  defaultPatientId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AddMedicalRecordDialogProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setOpen = controlledOnOpenChange !== undefined ? controlledOnOpenChange : setInternalOpen
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingPatients, setIsLoadingPatients] = useState(false)
  const [isLoadingDoctors, setIsLoadingDoctors] = useState(false)
  const [patientsList, setPatientsList] = useState<
    Array<{ id: string; name: string; createdAt: Date }>
  >([])
  const [doctorsList, setDoctorsList] = useState<Array<{ id: string; user?: { name: string } }>>([])
  const [images, setImages] = useState<string[]>([])
  // Initialize state from props - use key to reset when props change
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(
    isDoctor && currentDoctorId ? currentDoctorId : ''
  )
  const [selectedPatientId, setSelectedPatientId] = useState<string>(defaultPatientId || '')

  // Get selected patient data for ImageUpload
  const selectedPatient = patientsList.find((p) => p.id === selectedPatientId)

  // Sync selectedDoctorId when currentDoctorId changes using useLayoutEffect
  useLayoutEffect(() => {
    if (isDoctor && currentDoctorId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedDoctorId(currentDoctorId)
    }
  }, [isDoctor, currentDoctorId])

  // Sync selectedPatientId when defaultPatientId changes using useLayoutEffect
  useLayoutEffect(() => {
    if (defaultPatientId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedPatientId(defaultPatientId)
    }
  }, [defaultPatientId])

  useEffect(() => {
    if (!open) {
      // Reset state when dialog closes
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setImages([])
      if (!isDoctor) {
        setSelectedDoctorId('')
      }
      if (!defaultPatientId) {
        setSelectedPatientId('')
      }
      return
    }

    let isMounted = true

    // Load data asynchronously - IIFE to avoid setState in effect body
    void (async () => {
      setIsLoadingPatients(true)

      setIsLoadingDoctors(true)

      try {
        const [patientsRes, doctorsRes] = await Promise.all([getPatients(), getDoctors()])

        if (!isMounted) return

        if (patientsRes.success) {
          setPatientsList(patientsRes.data || [])
        }

        setIsLoadingPatients(false)

        if (doctorsRes.success) {
          setDoctorsList(doctorsRes.data || [])
        }

        setIsLoadingDoctors(false)
      } catch {
        if (!isMounted) return

        setIsLoadingPatients(false)

        setIsLoadingDoctors(false)
      }
    })()

    return () => {
      isMounted = false
    }
  }, [open, isDoctor, defaultPatientId])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)

    const formData = new FormData(event.currentTarget)

    const data: {
      patientId: string
      doctorId: string
      complaint: string
      examination: string
      diagnosis: string
      treatment: string
      prescription: string
      notes: string
      attachments: string | null
    } = {
      patientId: selectedPatientId,
      doctorId: selectedDoctorId,
      complaint: formData.get('complaint') as string,
      examination: formData.get('examination') as string,
      diagnosis: formData.get('diagnosis') as string,
      treatment: formData.get('treatment') as string,
      prescription: formData.get('prescription') as string,
      notes: formData.get('notes') as string,
      attachments: images.length > 0 ? JSON.stringify(images) : null,
    }

    const result = await createMedicalRecord(data)

    setIsLoading(false)

    if (result.success) {
      setOpen(false)
      setImages([])
      setSelectedDoctorId('')
      setSelectedPatientId('')
      toast.success('Medical record created successfully.')
    } else {
      toast.error(result.error || 'Something went wrong.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Medical Record
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>New Medical Record</DialogTitle>
            <DialogDescription>
              Record patient consultation and treatment details.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="patientId">Patient</Label>
                {isLoadingPatients ? (
                  <div className="h-10 flex items-center px-3 border rounded-md bg-muted">
                    <span className="text-sm text-muted-foreground">Loading patients...</span>
                  </div>
                ) : (
                  <Select
                    key={`patient-select-${selectedPatientId}`}
                    name="patientId"
                    required
                    value={selectedPatientId || undefined}
                    onValueChange={setSelectedPatientId}
                    disabled={isLoadingPatients}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select patient" />
                    </SelectTrigger>
                    <SelectContent>
                      {patientsList.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
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
                  <>
                    <Input
                      type="text"
                      value={currentDoctorName || ''}
                      disabled
                      className="bg-muted cursor-not-allowed"
                    />
                    <input type="hidden" name="doctorId" value={selectedDoctorId || ''} />
                  </>
                ) : (
                  <Select
                    key={`doctor-select-${selectedDoctorId}`}
                    name="doctorId"
                    required
                    value={selectedDoctorId || undefined}
                    onValueChange={setSelectedDoctorId}
                  >
                    <SelectTrigger>
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
              <Textarea id="complaint" name="complaint" placeholder="Reason for visit" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="examination">Examination</Label>
              <Textarea
                id="examination"
                name="examination"
                placeholder="Physical/Clinical findings"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="diagnosis">Diagnosis</Label>
              <Textarea id="diagnosis" name="diagnosis" placeholder="Assessment/Diagnosis" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="treatment">Treatment Plan</Label>
              <Textarea id="treatment" name="treatment" placeholder="Proposed treatment" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prescription">Prescription</Label>
              <Textarea
                id="prescription"
                name="prescription"
                placeholder="Medications prescribed"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Additional Notes</Label>
              <Textarea id="notes" name="notes" placeholder="Other relevant information" />
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
                  patientCreatedDate={selectedPatient.createdAt}
                />
              ) : (
                <div className="text-sm text-muted-foreground p-4 border border-dashed rounded-lg text-center">
                  Please select a patient first
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Record
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
