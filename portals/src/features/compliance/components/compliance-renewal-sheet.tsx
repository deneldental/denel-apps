import { FileText, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { createComplianceDocumentRenewal } from '@/lib/actions/compliance'
import { uploadFile } from '@/lib/actions/upload'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Textarea } from '@/shared/components/ui/textarea'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { fileNameFromUrl } from '@/shared/lib/file-name'

interface ComplianceRenewalSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  documentId: string
  onSaved: () => void
}

export function ComplianceRenewalSheet({
  open,
  onOpenChange,
  documentId,
  onSaved,
}: ComplianceRenewalSheetProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const receiptInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    documentUrl: '',
    receiptUrl: '',
    amountPaid: '',
    expiryDate: '',
    notes: '',
  })

  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [uploadingReceipt, setUploadingReceipt] = useState(false)

  const { isSubmitting, submit } = useSubmitGuard()

  const set = (key: keyof typeof form, value: unknown) => setForm((f) => ({ ...f, [key]: value }))

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'document' | 'receipt'
  ) => {
    const file = e.target.files?.[0]
    if (!file) return

    const setUploading = type === 'document' ? setUploadingDoc : setUploadingReceipt
    setUploading(true)

    try {
      const res = await uploadFile(file, {
        folder: 'compliance/renewals',
        storageCategory: 'system_docs',
        profile: 'imageOrPdf',
      })
      if (res.success && res.url) {
        set(type === 'document' ? 'documentUrl' : 'receiptUrl', res.url)
        toast.success(`${type === 'document' ? 'Document' : 'Receipt'} uploaded`)
      } else {
        surfaceApiError(res, 'Upload failed')
      }
    } finally {
      setUploading(false)
    }
  }

  const handleSave = () =>
    submit(async () => {
      if (!form.documentUrl) {
        toast.error('A new document file is required')
        return
      }
      if (!form.expiryDate) {
        toast.error('New expiry date is required')
        return
      }

      const payload = {
        documentUrl: form.documentUrl,
        receiptUrl: form.receiptUrl || null,
        amountPaid: form.amountPaid ? Number(form.amountPaid) : null,
        expiryDate: form.expiryDate,
        notes: form.notes.trim() || null,
      }

      const res = await createComplianceDocumentRenewal(documentId, payload)
      if (res.success) {
        toast.success('Renewal recorded')
        onSaved()
        onOpenChange(false)
      } else {
        surfaceApiError(res, 'Failed to save renewal')
      }
    })

  const docName = form.documentUrl ? fileNameFromUrl(form.documentUrl) : null
  const receiptName = form.receiptUrl ? fileNameFromUrl(form.receiptUrl) : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col sm:max-w-md w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Renew Document</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-5 py-4">
          <div className="space-y-1.5">
            <Label>New Document (Required)</Label>
            {docName ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate text-muted-foreground">{docName}</span>
                <button
                  type="button"
                  onClick={() => set('documentUrl', '')}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingDoc}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                <Upload className="h-4 w-4" />
                {uploadingDoc ? 'Uploading…' : 'Upload Document'}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => handleFileUpload(e, 'document')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="renewal-expiryDate">
              New Expiry Date <span className="text-destructive">*</span>
            </Label>
            <Input
              id="renewal-expiryDate"
              type="date"
              value={form.expiryDate}
              onChange={(e) => set('expiryDate', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="renewal-amountPaid">Amount Paid (Optional)</Label>
            <Input
              id="renewal-amountPaid"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 150.00"
              value={form.amountPaid}
              onChange={(e) => set('amountPaid', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Payment Receipt (Optional)</Label>
            {receiptName ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate text-muted-foreground">{receiptName}</span>
                <button
                  type="button"
                  onClick={() => set('receiptUrl', '')}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => receiptInputRef.current?.click()}
                disabled={uploadingReceipt}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                <Upload className="h-4 w-4" />
                {uploadingReceipt ? 'Uploading…' : 'Upload Receipt'}
              </button>
            )}
            <input
              ref={receiptInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => handleFileUpload(e, 'receipt')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="renewal-notes">Notes</Label>
            <Textarea
              id="renewal-notes"
              placeholder="Any additional notes..."
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <SheetFooter className="mt-auto pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting || uploadingDoc || uploadingReceipt}>
            {isSubmitting ? 'Saving…' : 'Save Renewal'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
