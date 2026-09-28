import { FileText, Plus, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  type ComplianceDocument,
  createComplianceDocument,
  updateComplianceDocument,
} from '@/lib/actions/compliance'
import { uploadFile } from '@/lib/actions/upload'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { Badge } from '@/shared/components/ui/badge'
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
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Switch } from '@/shared/components/ui/switch'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { fileNameFromUrl } from '@/shared/lib/file-name'

interface ComplianceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editRecord?: ComplianceDocument | null
  /** Category options for the picker — live compliance-categories (or the fallback set). */
  categories: string[]
  onSaved: () => void
}

export function ComplianceDialog({
  open,
  onOpenChange,
  editRecord,
  categories,
  onSaved,
}: ComplianceDialogProps) {
  const isEdit = !!editRecord
  const fileInputRef = useRef<HTMLInputElement>(null)

  const initialForm = {
    documentName: editRecord?.documentName ?? '',
    category: editRecord?.category ?? '',
    issuingAuthority: editRecord?.issuingAuthority ?? '',
    dateIssued: editRecord?.dateIssued ? editRecord.dateIssued.split('T')[0] : '',
    dateExpired: editRecord?.dateExpired ? editRecord.dateExpired.split('T')[0] : '',
    notes: editRecord?.notes ?? '',
    reminderEnabled: editRecord?.reminderEnabled ?? false,
    reminderMonthsBefore: editRecord?.reminderMonthsBefore ?? 3,
    reminderPhones: editRecord?.reminderPhones ?? ([] as string[]),
    reminderMessage:
      editRecord?.reminderMessage ??
      'Reminder: Your {documentName} expires on {dateExpired}. Please renew soon.',
    documentUrl: editRecord?.documentUrl ?? '',
  }

  const [form, setForm] = useState(initialForm)

  const [uploading, setUploading] = useState(false)
  const [phoneInput, setPhoneInput] = useState('')

  const { isSubmitting, submit } = useSubmitGuard()

  const isDirty =
    form.documentName !== initialForm.documentName ||
    form.category !== initialForm.category ||
    form.issuingAuthority !== initialForm.issuingAuthority ||
    form.dateIssued !== initialForm.dateIssued ||
    form.dateExpired !== initialForm.dateExpired ||
    form.notes !== initialForm.notes ||
    form.reminderEnabled !== initialForm.reminderEnabled ||
    form.reminderMonthsBefore !== initialForm.reminderMonthsBefore ||
    form.reminderMessage !== initialForm.reminderMessage ||
    form.documentUrl !== initialForm.documentUrl ||
    form.reminderPhones.join(',') !== initialForm.reminderPhones.join(',')

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  const set = (key: keyof typeof form, value: unknown) => setForm((f) => ({ ...f, [key]: value }))

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadFile(file, {
        folder: 'compliance',
        storageCategory: 'system_docs',
        profile: 'imageOrPdf',
      })
      if (res.success && res.url) {
        set('documentUrl', res.url)
        toast.success('Document uploaded')
      } else {
        surfaceApiError(res, 'Upload failed')
      }
    } finally {
      setUploading(false)
    }
  }

  const addPhone = () => {
    const trimmed = phoneInput.trim()
    if (!trimmed || form.reminderPhones.includes(trimmed)) return
    set('reminderPhones', [...form.reminderPhones, trimmed])
    setPhoneInput('')
  }

  const removePhone = (phone: string) =>
    set(
      'reminderPhones',
      form.reminderPhones.filter((p) => p !== phone)
    )

  const handleSave = () =>
    submit(async () => {
      if (!form.documentName.trim()) {
        toast.error('Document name is required')
        return
      }
      if (!form.category) {
        toast.error('Category is required')
        return
      }
      if (form.dateIssued && form.dateExpired && form.dateExpired < form.dateIssued) {
        toast.error('Expiry date must be on or after the issued date')
        return
      }
      if (form.reminderEnabled) {
        const months = form.reminderMonthsBefore
        if (!Number.isInteger(months) || months < 1 || months > 12) {
          toast.error('Reminder must be between 1 and 12 months before expiry')
          return
        }
      }

      const payload = {
        documentName: form.documentName.trim(),
        category: form.category,
        issuingAuthority: form.issuingAuthority.trim() || null,
        documentUrl: form.documentUrl || null,
        dateIssued: form.dateIssued || null,
        dateExpired: form.dateExpired || null,
        notes: form.notes.trim() || null,
        reminderEnabled: form.reminderEnabled,
        reminderMonthsBefore: form.reminderMonthsBefore,
        reminderPhones: form.reminderPhones,
        reminderMessage: form.reminderMessage || null,
      }

      const res = isEdit
        ? await updateComplianceDocument(editRecord?.id, payload)
        : await createComplianceDocument(payload)

      if (res.success) {
        toast.success(isEdit ? 'Record updated' : 'Record added')
        onSaved()
        onOpenChange(false)
      } else {
        surfaceApiError(res, 'Failed to save')
      }
    })

  const fileName = form.documentUrl ? fileNameFromUrl(form.documentUrl) : null

  return (
    <>
      <Sheet open={open} onOpenChange={guardedOnOpenChange}>
        <SheetContent className="flex flex-col sm:max-w-md md:max-w-xl w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{isEdit ? 'Edit Compliance Record' : 'Add Compliance Record'}</SheetTitle>
          </SheetHeader>

          <div className="space-y-5 py-2">
            {/* Document Name */}
            <div className="space-y-1.5">
              <Label htmlFor="compliance-documentName">
                Document Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="compliance-documentName"
                placeholder="e.g. Business Registration Certificate"
                value={form.documentName}
                onChange={(e) => set('documentName', e.target.value)}
                maxLength={200}
              />
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <Label htmlFor="compliance-category">
                Category <span className="text-destructive">*</span>
              </Label>
              <Select value={form.category} onValueChange={(v) => set('category', v)}>
                <SelectTrigger id="compliance-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Issuing Authority */}
            <div className="space-y-1.5">
              <Label htmlFor="compliance-authority">Issuing Authority</Label>
              <Input
                id="compliance-authority"
                placeholder="e.g. Ghana Health Service"
                value={form.issuingAuthority}
                onChange={(e) => set('issuingAuthority', e.target.value)}
                maxLength={200}
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="compliance-dateIssued">Date Issued</Label>
                <Input
                  id="compliance-dateIssued"
                  type="date"
                  value={form.dateIssued}
                  onChange={(e) => set('dateIssued', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="compliance-dateExpired">Date Expired</Label>
                <Input
                  id="compliance-dateExpired"
                  type="date"
                  value={form.dateExpired}
                  onChange={(e) => set('dateExpired', e.target.value)}
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="compliance-notes">Notes</Label>
              <Textarea
                id="compliance-notes"
                placeholder="Renewal instructions or additional notes…"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={2}
                maxLength={1000}
              />
            </div>

            {/* Document Upload */}
            <div className="space-y-1.5">
              <Label>Document</Label>
              {fileName ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate text-muted-foreground">{fileName}</span>
                  <button
                    type="button"
                    onClick={() => set('documentUrl', '')}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Remove document"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  <Upload className="h-4 w-4" />
                  {uploading ? 'Uploading…' : 'Upload Document (PDF, PNG, JPG)'}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>

            {/* Reminder Toggle */}
            <div className="rounded-md border border-border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Expiry Reminder</p>
                  <p className="text-xs text-muted-foreground">
                    Get notified before document expires
                  </p>
                </div>
                <Switch
                  checked={form.reminderEnabled}
                  onCheckedChange={(v) => set('reminderEnabled', v)}
                />
              </div>

              {form.reminderEnabled && (
                <div className="space-y-4 pt-1 border-t border-border">
                  {/* Months before */}
                  <div className="flex items-center gap-3">
                    <Label htmlFor="compliance-reminderMonths" className="w-36 shrink-0 text-sm">
                      Remind me
                    </Label>
                    <Input
                      id="compliance-reminderMonths"
                      type="number"
                      min={1}
                      max={12}
                      className="w-20"
                      value={form.reminderMonthsBefore}
                      onChange={(e) => set('reminderMonthsBefore', Number(e.target.value))}
                    />
                    <span className="text-sm text-muted-foreground">months before expiry</span>
                  </div>

                  {/* Phone numbers */}
                  <div className="space-y-2">
                    <Label htmlFor="compliance-phoneInput" className="text-sm">
                      SMS Phone Numbers
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="compliance-phoneInput"
                        placeholder="+233..."
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPhone())}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={addPhone}
                        aria-label="Add phone number"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {form.reminderPhones.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {form.reminderPhones.map((phone) => (
                          <Badge key={phone} variant="secondary" className="gap-1 pr-1">
                            {phone}
                            <button
                              type="button"
                              onClick={() => removePhone(phone)}
                              aria-label={`Remove ${phone}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Full SMS setup is available in Settings → Reminders
                    </p>
                  </div>

                  {/* Reminder message */}
                  <div className="space-y-1.5">
                    <Label htmlFor="compliance-reminderMessage" className="text-sm">
                      Reminder Message
                    </Label>
                    <Textarea
                      id="compliance-reminderMessage"
                      value={form.reminderMessage}
                      onChange={(e) => set('reminderMessage', e.target.value)}
                      placeholder="e.g. Reminder: Your {documentName} expires on {dateExpired}. Please renew soon."
                      maxLength={500}
                      rows={3}
                    />
                    <p className="text-xs text-muted-foreground">
                      Use <code>{'{documentName}'}</code> and <code>{'{dateExpired}'}</code> as
                      template tokens.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <SheetFooter className="mt-auto pt-4">
            <Button variant="outline" onClick={() => guardedOnOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting || uploading}>
              {isSubmitting ? 'Saving…' : isEdit ? 'Update' : 'Add Record'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
