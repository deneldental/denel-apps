import { Loader2, Upload } from 'lucide-react'
import { useState } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { uploadConsentForm } from '@/lib/actions/ortho-consent'

interface UploadConsentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient: {
    id: string
    name: string
    patientId: string | null
  } | null
  onSuccess?: () => void
}

export function UploadConsentDialog({
  open,
  onOpenChange,
  patient,
  onSuccess,
}: UploadConsentDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!patient || !file) {
      toast.error('Please select a file')
      return
    }

    setIsSubmitting(true)

    try {
      // Step 1: Process and upload the PDF (validate, split, recombine with templates)
      toast.loading('Processing consent form...')

      const formData = new FormData()
      formData.append('file', file)
      formData.append('patientName', patient.name)

      const processResponse = await fetch('/api/ortho-consent/process', {
        method: 'POST',
        body: formData,
      })

      const processResult = await processResponse.json()

      if (!processResult.success) {
        toast.dismiss()
        toast.error(processResult.error || 'Failed to process consent form')
        setIsSubmitting(false)
        return
      }

      // Step 2: Save consent form record to database
      toast.dismiss()
      toast.loading('Saving consent form...')

      const result = await uploadConsentForm({
        patientId: patient.id,
        consentFormUrl: processResult.url,
        notes: notes || undefined,
      })

      toast.dismiss()

      if (result.success) {
        toast.success('Consent form uploaded successfully')
        onOpenChange(false)
        setFile(null)
        setNotes('')
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to save consent form')
      }
    } catch (error) {
      toast.dismiss()
      toast.error('An error occurred while uploading')
      console.error('Upload error:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      // Validate file type (PDF only)
      if (selectedFile.type !== 'application/pdf') {
        toast.error('Only PDF files are allowed')
        e.target.value = '' // Clear the input
        return
      }

      // Validate file size (max 10MB)
      if (selectedFile.size > 10 * 1024 * 1024) {
        toast.error('File size must be less than 10MB')
        e.target.value = '' // Clear the input
        return
      }

      setFile(selectedFile)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Upload Consent Form</DialogTitle>
            <DialogDescription>
              Upload the 2-page signed consent form (pages 1 and 5) for {patient?.name} (
              {patient?.patientId || 'N/A'}). The system will automatically combine it with the
              template pages.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="file">Consent Form (PDF - 2 pages)</Label>
              <p className="text-xs text-muted-foreground">
                Upload a 2-page PDF containing the signed pages 1 and 5 from the template
              </p>
              <div className="flex items-center gap-2">
                <input
                  id="file"
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSubmitting}
                  required
                />
              </div>
              {file && <div className="text-sm text-green-600">File selected: {file.name}</div>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add any additional notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isSubmitting}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !file}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
