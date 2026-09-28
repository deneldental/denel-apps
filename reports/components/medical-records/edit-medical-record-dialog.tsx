import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { updateMedicalRecord } from '@/lib/actions/medical-records'
import type { MedicalRecord } from '@/src/pages/medical-records/columns'
import { ImageUpload } from './image-upload'

interface EditMedicalRecordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: MedicalRecord
}

export function EditMedicalRecordDialog({
  open,
  onOpenChange,
  record,
}: EditMedicalRecordDialogProps) {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const [doctorsList, setDoctorsList] = useState<
    Array<{ id: string; user: { name: string } | null }>
  >([])
  const [formData, setFormData] = useState({
    doctorId: '',
    complaint: '',
    examination: '',
    diagnosis: '',
    treatment: '',
    prescription: '',
    notes: '',
  })

  const [images, setImages] = useState<string[]>([])

  const [prevRecordId, setPrevRecordId] = useState(record?.id)
  if (record && record.id !== prevRecordId) {
    setPrevRecordId(record.id)
    setFormData({
      doctorId: (record.doctorId as string) || '',
      complaint: (record.complaint as string) || '',
      examination: (record.examination as string) || '',
      diagnosis: (record.diagnosis as string) || '',
      treatment: (record.treatment as string) || '',
      prescription: (record.prescription as string) || '',
      notes: (record.notes as string) || '',
    })
    // Load existing images
    if (record.attachments) {
      try {
        const parsed = JSON.parse(record.attachments as string)
        setImages(Array.isArray(parsed) ? parsed : [])
      } catch {
        setImages([])
      }
    } else {
      setImages([])
    }
  }

  useEffect(() => {
    if (open) {
      getDoctors().then((res) => {
        if (res.success) setDoctorsList(res.data || [])
      })
    }
  }, [open])

  const recordPatient = (record.patient ?? null) as {
    name?: string | null
    createdAt?: string | Date | null
  } | null

  const patientName = recordPatient?.name ?? 'patient'
  const patientCreatedDate = new Date(
    (recordPatient?.createdAt ?? record.createdAt ?? new Date()) as string | number | Date
  )

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)

    const data = {
      doctorId: formData.doctorId,
      complaint: formData.complaint || null,
      examination: formData.examination || null,
      diagnosis: formData.diagnosis || null,
      treatment: formData.treatment || null,
      prescription: formData.prescription || null,
      notes: formData.notes || null,
      attachments: images.length > 0 ? JSON.stringify(images) : null,
    }

    const result = await updateMedicalRecord(record.id, data)

    setIsLoading(false)

    if (result.success) {
      onOpenChange(false)
      toast.success('Medical record updated successfully.')
      navigate(0)
    } else {
      toast.error(result.error || 'Something went wrong.')
    }
  }

  if (!record) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Medical Record</DialogTitle>
            <DialogDescription>
              Update patient consultation and treatment details.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="doctorId">Doctor</Label>
              <Select
                value={formData.doctorId}
                onValueChange={(value) => setFormData({ ...formData, doctorId: value })}
                required
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="complaint">Chief Complaint</Label>
              <Textarea
                id="complaint"
                value={formData.complaint}
                onChange={(e) => setFormData({ ...formData, complaint: e.target.value })}
                placeholder="Reason for visit"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="examination">Examination</Label>
              <Textarea
                id="examination"
                value={formData.examination}
                onChange={(e) => setFormData({ ...formData, examination: e.target.value })}
                placeholder="Physical/Clinical findings"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="diagnosis">Diagnosis</Label>
              <Textarea
                id="diagnosis"
                value={formData.diagnosis}
                onChange={(e) => setFormData({ ...formData, diagnosis: e.target.value })}
                placeholder="Assessment/Diagnosis"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="treatment">Treatment Plan</Label>
              <Textarea
                id="treatment"
                value={formData.treatment}
                onChange={(e) => setFormData({ ...formData, treatment: e.target.value })}
                placeholder="Proposed treatment"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prescription">Prescription</Label>
              <Textarea
                id="prescription"
                value={formData.prescription}
                onChange={(e) => setFormData({ ...formData, prescription: e.target.value })}
                placeholder="Medications prescribed"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Additional Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Record
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
