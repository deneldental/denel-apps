import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { AudienceRecipient } from '@/lib/actions/crm'
import { getAdTemplates } from '@/lib/actions/crm'
import { sendSMS } from '@/lib/actions/sms'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
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
import { AudienceBuilderPanel } from './audience-builder-panel'

interface SmsComposerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Display label for the recipient(s) — e.g. "Henry Mensah" or "8 patients". */
  recipientLabel: string
  /** Default body shown in the textarea when the sheet opens. */
  defaultMessage: string
  /**
   * Called once the user clicks Send. The sheet handles the toast itself.
   * In audience-builder mode the resolved recipient list is passed through.
   */
  onSend: (message: string, recipients?: AudienceRecipient[]) => void
  /**
   * §13.4 — opt into the audience-builder panel. When enabled, the operator
   * picks a segment AND/OR treatment-type + tag filters; recipients resolve
   * live and feed into the send path. `recipientLabel` is then derived from
   * the resolved count rather than the prop.
   */
  audienceBuilder?: boolean
}

/**
 * Mock SMS composer used across all CRM campaign pages.
 *
 * TODO(backend-wiring): wire `onSend` to the real SMS endpoint
 * (`POST /api/sms/send`) and surface failures via the `statusMessage` prop on
 * `<SheetFormLayout>` instead of the optimistic toast we fire here.
 */
export function SmsComposerSheet({
  open,
  onOpenChange,
  recipientLabel,
  defaultMessage,
  onSend,
  audienceBuilder = false,
}: SmsComposerSheetProps) {
  const [message, setMessage] = useState(defaultMessage)
  const [recipients, setRecipients] = useState<AudienceRecipient[]>([])
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set())
  const [selectedTemplate, setSelectedTemplate] = useState<string>('none')
  const { isSubmitting, submit } = useSubmitGuard()

  const templatesQuery = useApiQuery(queryKeys.adTemplates.list(), () => getAdTemplates())
  const templates = templatesQuery.data ?? []

  // Re-seed the textarea whenever the sheet (re)opens with a different default.
  useEffect(() => {
    if (open) setMessage(defaultMessage)
  }, [open, defaultMessage])

  // Reset the resolved audience each time the sheet (re)opens.
  useEffect(() => {
    if (open) setRecipients([])
  }, [open])

  const handleResolved = useCallback((next: AudienceRecipient[]) => {
    setRecipients(next)
    // Select all by default when audience resolves
    setSelectedRecipients(new Set(next.map((r) => r.patientId)))
  }, [])

  const finalRecipients = audienceBuilder
    ? recipients.filter((r) => selectedRecipients.has(r.patientId))
    : recipients

  // In audience mode the label/count come from the live resolution.
  const effectiveLabel = audienceBuilder
    ? `${finalRecipients.length} ${finalRecipients.length === 1 ? 'patient' : 'patients'}`
    : recipientLabel

  const isDirty = message !== defaultMessage

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  const handleSubmit = () =>
    submit(async () => {
      const trimmed = message.trim()
      if (!trimmed) {
        toast.error('Message cannot be empty')
        return
      }
      if (audienceBuilder && finalRecipients.length === 0) {
        toast.error('No recipients selected')
        return
      }

      const payload = audienceBuilder
        ? finalRecipients.map((r) => ({
            phone: r.phone,
            message: trimmed,
            patientId: r.patientId,
            patientName: r.patientName,
          }))
        : [] // If not audience builder, the parent usually handles sending or we pass the message back

      if (audienceBuilder) {
        const res = await sendSMS(payload, undefined, 'bulk')
        if (!res.success) {
          toast.error(res.error || 'Failed to send SMS')
          return
        }
      }

      onSend(trimmed, audienceBuilder ? finalRecipients : undefined)
      toast.success(`SMS queued to ${effectiveLabel}`)
      onOpenChange(false)
    })

  const trimmedLength = message.trim().length
  const segmentCount = Math.max(1, Math.ceil(trimmedLength / 160))
  /** Hard cap: 5 SMS segments = 765 GSM-7 characters. */
  const MAX_LENGTH = 765

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Send SMS"
        description={
          audienceBuilder ? 'Build an audience, then send' : `Recipient: ${recipientLabel}`
        }
        size="md"
        submitLabel="Send SMS"
        submitDisabled={trimmedLength === 0 || (audienceBuilder && finalRecipients.length === 0)}
        submitting={isSubmitting}
        onSubmit={handleSubmit}
      >
        <div className="grid gap-4">
          {audienceBuilder && <AudienceBuilderPanel onResolved={handleResolved} />}

          {audienceBuilder && recipients.length > 0 && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-medium text-muted-foreground">
                  Select Recipients ({finalRecipients.length}/{recipients.length})
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => {
                    if (selectedRecipients.size === recipients.length) {
                      setSelectedRecipients(new Set())
                    } else {
                      setSelectedRecipients(new Set(recipients.map((r) => r.patientId)))
                    }
                  }}
                >
                  {selectedRecipients.size === recipients.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {recipients.map((r) => (
                  <label
                    key={r.patientId}
                    className="flex items-center space-x-2 p-1 hover:bg-accent rounded text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedRecipients.has(r.patientId)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selectedRecipients)
                        if (checked) next.add(r.patientId)
                        else next.delete(r.patientId)
                        setSelectedRecipients(next)
                      }}
                    />
                    <span>
                      {r.patientName}{' '}
                      <span className="text-muted-foreground text-xs">({r.phone})</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {templates.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="sms-template">Template</Label>
                <Select
                  value={selectedTemplate}
                  onValueChange={(val) => {
                    setSelectedTemplate(val)
                    if (val !== 'none') {
                      const tpl = templates.find((t) => t.id === val)
                      if (tpl) setMessage(tpl.body)
                    }
                  }}
                >
                  <SelectTrigger id="sms-template">
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No template (Custom message)</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="sms-body">Message</Label>
              <Textarea
                id="sms-body"
                rows={6}
                value={message}
                maxLength={MAX_LENGTH}
                onChange={(e) => {
                  setMessage(e.target.value)
                  if (selectedTemplate !== 'none') setSelectedTemplate('none')
                }}
                placeholder="Type your message here... Use {{firstName}} for the patient's first name."
              />
              <p
                className={
                  segmentCount > 2 ? 'text-xs text-warning' : 'text-xs text-muted-foreground'
                }
              >
                {trimmedLength} / {MAX_LENGTH} characters · ~{segmentCount} SMS
              </p>
            </div>
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
