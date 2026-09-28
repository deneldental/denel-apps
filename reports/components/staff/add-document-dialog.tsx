import { Loader2 } from 'lucide-react'
import { useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { addStaffDocument } from '@/lib/actions/staff'

interface AddDocumentDialogProps {
  staffId: string
  staffName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddDocumentDialog({
  staffId,
  staffName,
  open,
  onOpenChange,
}: AddDocumentDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)

    const form = event.currentTarget
    const formData = new FormData(form)

    const title = formData.get('title') as string
    const description = formData.get('description') as string
    const file = formData.get('file') as File | null

    if (!title || !file || file.size === 0) {
      toast.error('Please provide a title and select a file')
      setIsLoading(false)
      return
    }

    // Upload file
    const { uploadStaffFile } = await import('@/lib/actions/upload-staff')
    const uploadResult = await uploadStaffFile({
      file,
      staffName,
      documentTitle: title,
    })

    if (!uploadResult.success) {
      toast.error(uploadResult.error || 'Failed to upload file')
      setIsLoading(false)
      return
    }

    // Add document record
    const data = {
      staffId,
      title,
      description: description || null,
      fileUrl: uploadResult.url!,
    }

    const result = await addStaffDocument(data)

    setIsLoading(false)

    if (result.success) {
      onOpenChange(false)
      form.reset()
      toast.success('Document added successfully.')
      navigate(0)
    } else {
      toast.error(result.error || 'Something went wrong.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add Document</DialogTitle>
            <DialogDescription>Upload a document for {staffName}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input id="title" name="title" placeholder="e.g., Employment Contract" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Additional notes about this document"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="file">File *</Label>
              <Input
                id="file"
                name="file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                required
              />
              <p className="text-xs text-muted-foreground">
                Supported formats: PDF, JPG, PNG, DOC, DOCX
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Upload Document
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
