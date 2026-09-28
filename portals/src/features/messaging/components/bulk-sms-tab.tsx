import { Eye, Loader2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AudienceBuilderPanel } from '@/features/crm/components/audience-builder-panel'
import type { AudienceRecipient } from '@/lib/actions/crm'
import { sendSMS } from '@/lib/actions/sms'
import { api } from '@/lib/api-client'
import { useBranding } from '@/lib/branding-context'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Checkbox } from '@/shared/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog'
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

export function BulkSMSTab() {
  const branding = useBranding()
  const [from, setFrom] = useState(branding.smsSenderId)
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [selectedTemplate, setSelectedTemplate] = useState<string>('none')

  const [recipients, setRecipients] = useState<AudienceRecipient[]>([])
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set())

  const templatesQuery = useApiQuery<any[]>(queryKeys.reminderTemplates.list(), () =>
    api.get<any[]>('/api/reminder-templates')
  )
  // filter out inactive templates if needed, or just show all
  const templates = (templatesQuery.data ?? []).filter((t: any) => t.isActive)

  const sendMutation = useApiMutation(
    (vars: {
      recipients: Array<{
        phone: string
        message: string
        patientId?: string
        patientName?: string
      }>
      from: string
    }) => sendSMS(vars.recipients, vars.from, 'bulk')
  )
  const isLoading = sendMutation.isPending

  const handleResolved = useCallback((next: AudienceRecipient[]) => {
    setRecipients(next)
    setSelectedRecipients(new Set(next.map((r) => r.patientId)))
  }, [])

  const finalRecipients = recipients.filter((r) => selectedRecipients.has(r.patientId))

  const handleSend = async () => {
    if (finalRecipients.length === 0) {
      toast.error('Please select at least one recipient')
      return
    }

    const trimmed = message.trim()
    if (!trimmed) {
      toast.error('Please enter a message')
      return
    }

    const payload = finalRecipients.map((r) => ({
      phone: r.phone,
      message: trimmed,
      patientId: r.patientId,
      patientName: r.patientName,
    }))

    try {
      await sendMutation.mutateAsync({ recipients: payload, from })
      toast.success(`SMS queued to ${finalRecipients.length} recipient(s)`)
      setMessage('')
      setSelectedTemplate('none')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send SMS')
    }
  }

  const trimmedLength = message.trim().length
  const segmentCount = Math.max(1, Math.ceil(trimmedLength / 160))
  const MAX_LENGTH = 765

  const insertPlaceholder = (placeholder: string) => {
    const el = textareaRef.current
    if (!el) {
      setMessage(message + placeholder)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const text = message
    const before = text.substring(0, start)
    const after = text.substring(end, text.length)
    setMessage(before + placeholder + after)

    // reset selection after render
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(start + placeholder.length, start + placeholder.length)
    }, 0)

    if (selectedTemplate !== 'none') setSelectedTemplate('none')
  }

  const getPreviewMessage = () => {
    let preview = message.replace(/\{\{firstName\}\}/g, 'John')
    preview = preview.replace(/\{\{clinicName\}\}/g, from || 'Denel Dental')
    return preview
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bulk SMS</CardTitle>
          <CardDescription>
            Send personalized SMS messages to multiple recipients based on filters.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="from">From (Sender Name)</Label>
            <Input
              id="from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder={branding.smsSenderId}
            />
          </div>

          <div className="space-y-4">
            <Label className="text-base font-semibold">Audience Selection</Label>
            <AudienceBuilderPanel onResolved={handleResolved} />
          </div>

          {recipients.length > 0 && (
            <div className="space-y-2 rounded-lg border bg-muted/10 p-4">
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
              <div className="max-h-60 overflow-y-auto space-y-1">
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

          <div className="space-y-2">
            <Label htmlFor="sms-template">Message Template</Label>
            <Select
              value={selectedTemplate}
              onValueChange={(val) => {
                setSelectedTemplate(val)
                if (val !== 'none') {
                  const tpl = templates.find((t) => t.id === val)
                  if (tpl) {
                    // sms templates use either single braces or double braces, let's normalize to double braces for the UI placeholders
                    let msg = tpl.messageTemplate
                    msg = msg.replace(/\{firstName\}/g, '{{firstName}}')
                    msg = msg.replace(/\{clinicName\}/g, '{{clinicName}}')
                    setMessage(msg)
                  }
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="message">Message Content</Label>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 text-xs">
                    <Eye className="w-4 h-4 mr-2" />
                    Preview
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Message Preview</DialogTitle>
                  </DialogHeader>
                  <div className="bg-muted p-4 rounded-lg text-sm whitespace-pre-wrap">
                    {getPreviewMessage() || (
                      <span className="text-muted-foreground italic">Message is empty...</span>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <Textarea
              id="message"
              ref={textareaRef}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value)
                if (selectedTemplate !== 'none') setSelectedTemplate('none')
              }}
              placeholder="Enter your message here..."
              rows={5}
              maxLength={MAX_LENGTH}
            />

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-1">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs text-muted-foreground mr-1">Insert:</span>
                <Badge
                  variant="outline"
                  className="cursor-pointer hover:bg-accent text-xs font-normal"
                  onClick={() => insertPlaceholder('{{firstName}}')}
                >
                  {`{{firstName}}`}
                </Badge>
                <Badge
                  variant="outline"
                  className="cursor-pointer hover:bg-accent text-xs font-normal"
                  onClick={() => insertPlaceholder('{{clinicName}}')}
                >
                  {`{{clinicName}}`}
                </Badge>
              </div>
              <p
                className={
                  segmentCount > 2
                    ? 'text-xs text-warning whitespace-nowrap'
                    : 'text-xs text-muted-foreground whitespace-nowrap'
                }
              >
                {trimmedLength} / {MAX_LENGTH} characters · ~{segmentCount} SMS
              </p>
            </div>
          </div>

          <Button
            onClick={handleSend}
            disabled={isLoading || finalRecipients.length === 0 || message.trim().length === 0}
            className="w-full"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send SMS to {finalRecipients.length} Recipients
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
