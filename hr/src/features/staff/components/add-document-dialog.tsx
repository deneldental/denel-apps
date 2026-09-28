import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@denel/ui'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { type LookupRow, listStaffDocumentTypes } from '@/lib/actions/lookups'
import { addStaffDocument } from '@/lib/actions/staff'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB

interface AddDocumentDialogProps {
  staffId: string
  staffName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // Parent re-fetches the staff record (which includes documents) instead of
  // forcing a full-page reload via `navigate(0)`.
  onUploaded?: () => void | Promise<void>
}

export function AddDocumentDialog({
  staffId,
  staffName,
  open,
  onOpenChange,
  onUploaded,
}: AddDocumentDialogProps) {
  const { isSubmitting, submit } = useSubmitGuard()
  // Track dirty state for the guard: set to true once any field has been touched.
  const [isDirty, setIsDirty] = useState(false)
  const [types, setTypes] = useState<LookupRow[]>([])

  useEffect(() => {
    if (!open) return
    listStaffDocumentTypes().then((res) => {
      if (res.success && Array.isArray(res.data)) setTypes(res.data)
    })
  }, [open])

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget

    await submit(async () => {
      const formData = new FormData(form)

      const title = formData.get('title') as string
      const description = formData.get('description') as string
      const documentType = formData.get('documentType') as string
      const file = formData.get('file') as File | null

      // The file input is `required`, so this is only reachable via a
      // non-empty selection — but guard explicitly rather than asserting.
      if (!file) return
      // Client-side file size check (backend limit is 25 MB)
      if (file.size > MAX_FILE_SIZE_BYTES) {
        toast.error('File exceeds the 25 MB limit. Please choose a smaller file.')
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
        return
      }

      if (!uploadResult.url) {
        toast.error('Upload succeeded but no URL was returned')
        return
      }

      // Add document record
      const data = {
        staffId,
        title,
        description: description || null,
        documentType: documentType || 'other',
        fileUrl: uploadResult.url,
      }

      const result = await addStaffDocument(data)

      if (result.success) {
        setIsDirty(false)
        onOpenChange(false)
        form.reset()
        toast.success('Document added successfully.')
        await onUploaded?.()
      } else {
        surfaceApiError(result, 'Something went wrong.')
      }
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={guardedOnOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={onSubmit} onChange={() => setIsDirty(true)}>
            <DialogHeader>
              <DialogTitle>Add Document</DialogTitle>
              <DialogDescription>Upload a document for {staffName}.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="doc-title">Title *</Label>
                <Input
                  id="doc-title"
                  name="title"
                  placeholder="e.g., Employment Contract"
                  maxLength={200}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-type">Document Type</Label>
                <Select
                  name="documentType"
                  defaultValue="other"
                  onValueChange={() => setIsDirty(true)}
                >
                  <SelectTrigger id="doc-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((t) => (
                      <SelectItem key={t.id} value={t.name}>
                        {t.displayName ?? t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-description">Description</Label>
                <Textarea
                  id="doc-description"
                  name="description"
                  placeholder="Additional notes about this document"
                  rows={3}
                  maxLength={1000}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-file">File *</Label>
                <Input
                  id="doc-file"
                  name="file"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Supported formats: PDF, JPG, PNG (max 25 MB)
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Upload Document
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
