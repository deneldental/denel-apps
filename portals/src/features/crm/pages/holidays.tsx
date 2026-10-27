import { format, parseISO } from 'date-fns'
import { PartyPopper, RefreshCw, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'
import { useConfirm } from '@/shared/hooks/use-confirm'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

type ReminderTemplate = {
  id: string
  name: string
  messageTemplate: string
  isActive: boolean
}

/** A row of GET /api/sms/messages: the sms_messages columns plus the joined patient name. */
type SmsMessage = {
  id: string
  recipient: string
  content: string
  patient: { id: string; name: string } | null
  status: string
  sentAt: string | null
  createdAt: string
}

function buildMessage(template: string, clinicName: string) {
  return template
    .replace(/\{firstName\}/g, 'there')
    .replace(/\{patientName\}/g, 'Patient')
    .replace(/\{clinicName\}/g, clinicName)
    .replace(/\{date\}/g, format(new Date(), 'MMMM d, yyyy'))
}

export default function HolidaysPage() {
  const [templates, setTemplates] = useState<ReminderTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [message, setMessage] = useState('')
  const { isSubmitting, submit } = useSubmitGuard()
  const { confirm, confirmDialog } = useConfirm()
  const [history, setHistory] = useState<SmsMessage[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const clinicName = import.meta.env.VITE_CLINIC_NAME || 'Denel Dental'

  useEffect(() => {
    ;(async () => {
      const res = await api.get<ReminderTemplate[]>('/api/reminder-templates')
      if (res.success && res.data) {
        setTemplates(res.data.filter((t) => t.isActive))
      } else {
        toast.error('Could not load templates')
      }
    })()
  }, [])

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const res = await api.get<SmsMessage[]>('/api/sms/messages')
    if (res.success && res.data) setHistory(res.data)
    setLoadingHistory(false)
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  function selectTemplate(templateId: string) {
    setSelectedTemplateId(templateId)
    const tpl = templates.find((t) => t.id === templateId)
    if (tpl) setMessage(buildMessage(tpl.messageTemplate, clinicName))
  }

  // Basic phone number sanity check: must start with + or digit, contain only digits/spaces/dashes/parens, min 7 digits
  const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/

  async function sendToAll() {
    if (!message.trim()) {
      toast.error('Enter a message first')
      return
    }

    // Fetch patients first so we can show recipient count in the confirm dialog
    const patientsRes =
      await api.get<Array<{ id: string; name: string; phone?: string; guardianPhone?: string }>>(
        '/api/patients'
      )
    if (!patientsRes.success || !patientsRes.data) {
      surfaceApiError(patientsRes, 'Failed to fetch patients')
      return
    }
    const recipients = patientsRes.data
      .map((p) => ({
        phone: p.phone || p.guardianPhone || '',
        message: message
          .replace(/\{firstName\}/g, p.name?.split(' ')[0] || 'there')
          .replace(/\{patientName\}/g, p.name || 'Patient'),
        patientId: p.id,
      }))
      .filter((r) => PHONE_RE.test(r.phone))

    if (recipients.length === 0) {
      toast.error('No patients with valid phone numbers found')
      return
    }

    if (
      !(await confirm({
        title: 'Send Bulk SMS',
        description: `Send holiday SMS to ${recipients.length} patients?`,
        confirmLabel: 'Send',
      }))
    )
      return

    await submit(async () => {
      const res = await api.post('/api/sms/send', {
        recipients,
        from: clinicName,
        type: 'bulk',
      })
      if (res.success) {
        toast.success(`Holiday SMS sent to ${recipients.length} patients`)
        loadHistory()
      } else {
        surfaceApiError(res, 'Failed to send SMS')
      }
    })
  }

  const statusVariant = (status: string) => {
    if (status === 'delivered' || status === 'sent') return 'success'
    if (status === 'failed') return 'destructive'
    return 'secondary'
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
          <PartyPopper className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Holidays</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Broadcast holiday greetings or clinic closure notices to all patients.
          </p>
        </div>
      </div>

      {/* Compose */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compose Holiday Message</CardTitle>
          <CardDescription>
            Select a template or write a custom message and send to all patients at once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="holiday-template">Template</Label>
            <Select value={selectedTemplateId} onValueChange={selectTemplate}>
              <SelectTrigger id="holiday-template">
                <SelectValue placeholder="Pick a reminder template…" />
              </SelectTrigger>
              <SelectContent>
                {templates.length === 0 ? (
                  <SelectItem value="_none" disabled>
                    No templates found
                  </SelectItem>
                ) : (
                  templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="holiday-message">Message</Label>
            <Textarea
              id="holiday-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={918}
              placeholder="Type a holiday message. Use {firstName}, {clinicName} as placeholders…"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Available placeholders: <code className="text-xs">{'{firstName}'}</code>,{' '}
                <code className="text-xs">{'{clinicName}'}</code>
              </p>
              <p
                className={`text-xs tabular-nums ${message.length > 160 ? 'text-orange-500' : 'text-muted-foreground'}`}
              >
                {message.length} / 160
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={sendToAll} disabled={isSubmitting || !message.trim()}>
              {isSubmitting ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send to all patients
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base">SMS History</CardTitle>
            <CardDescription>Recent bulk SMS messages sent to patients.</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={loadHistory} disabled={loadingHistory}>
            <RefreshCw className={`h-4 w-4 ${loadingHistory ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="rounded-b-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingHistory ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : history.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No SMS history yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  history.map((msg) => (
                    <TableRow key={msg.id}>
                      <TableCell className="text-sm">
                        <div>{msg.patient?.name || '—'}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {msg.recipient}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="text-sm line-clamp-2">{msg.content}</p>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={statusVariant(msg.status) as any}
                          className="capitalize text-[10px]"
                        >
                          {msg.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {msg.sentAt
                          ? format(parseISO(msg.sentAt), 'MMM d, h:mm a')
                          : msg.createdAt
                            ? format(parseISO(msg.createdAt), 'MMM d, h:mm a')
                            : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  )
}
