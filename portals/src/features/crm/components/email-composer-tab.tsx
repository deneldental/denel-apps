import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Mail, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { type EmailRecipient, getEmailConfigStatus, sendEmail } from '@/lib/actions/email'
import { getPatients } from '@/lib/actions/patients'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { PatientPicker, type PickerPatient } from '@/shared/components/patient-picker'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import { surfaceApiError } from '@/shared/lib/api-error'

interface PatientRow extends PickerPatient {
  email?: string | null
}

interface SelectedRecipient {
  to: string
  patientId: string
  patientName: string
}

/**
 * §21.3 — CRM email composer wired to the Resend gateway.
 *
 * Replaces the previous mock/TODO send path: composes subject + body + a
 * personalised recipient list and POSTs to `/api/email/send` via the
 * `sendEmail` action. The gateway answers `503` when `RESEND_API_KEY` is
 * absent, so we probe `getEmailConfigStatus()` on mount and surface a
 * not-configured banner (send is disabled). Failures bubble through
 * `surfaceApiError`; success / partial-send counts go through a toast.
 */
const EMAIL_CONFIG_STATUS_KEY = ['messaging', 'email', 'config-status'] as const

export function EmailComposerTab() {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [recipients, setRecipients] = useState<SelectedRecipient[]>([])
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [sending, setSending] = useState(false)

  const patientsQuery = useApiQuery<PatientRow[]>(queryKeys.patients.list(), () => getPatients())
  const patientsList = patientsQuery.data ?? []

  // getEmailConfigStatus() never throws (it always resolves a plain status
  // object), so this stays a raw useQuery rather than useApiQuery's unwrap.
  const configStatusQuery = useQuery({
    queryKey: EMAIL_CONFIG_STATUS_KEY,
    queryFn: getEmailConfigStatus,
  })
  // null = still probing; true/false = resolved gateway state. Treat an
  // "unknown" probe (auth/network) as configured so we don't block a working
  // gateway on a transient failure — the send path still guards.
  const [configuredOverride, setConfiguredOverride] = useState<boolean | null>(null)
  const configured =
    configuredOverride ??
    (configStatusQuery.data
      ? configStatusQuery.data.unknown
        ? true
        : configStatusQuery.data.configured
      : null)

  function addRecipient() {
    if (!selectedPatientId) {
      toast.error('Select a patient')
      return
    }
    const patient = patientsList.find((p) => p.id === selectedPatientId)
    if (!patient) return
    const email = patient.email
    if (!email) {
      toast.error(`${patient.name} has no email address`)
      return
    }
    if (recipients.some((r) => r.to === email)) {
      toast.error('Patient already added')
      return
    }
    setRecipients((prev) => [
      ...prev,
      { to: email, patientId: patient.id, patientName: patient.name },
    ])
    setSelectedPatientId('')
  }

  function removeRecipient(to: string) {
    setRecipients((prev) => prev.filter((r) => r.to !== to))
  }

  async function handleSend() {
    if (!subject.trim()) {
      toast.error('Subject is required')
      return
    }
    if (!body.trim()) {
      toast.error('Email body is required')
      return
    }
    if (!recipients.length) {
      toast.error('Add at least one recipient')
      return
    }

    const payload: EmailRecipient[] = recipients.map((r) => ({
      to: r.to,
      subject,
      html: body.replace(/\{PatientName\}/g, r.patientName),
      patientId: r.patientId,
    }))

    setSending(true)
    const res = await sendEmail(payload, undefined, 'custom')
    setSending(false)

    if (!res.success) {
      // 503 (not configured) flips the banner so the operator gets the why.
      if (res.error?.toLowerCase().includes('not configured')) setConfiguredOverride(false)
      surfaceApiError(res, 'Failed to send email')
      return
    }

    const failed = res.data?.failed ?? 0
    if (failed > 0) {
      const sent = res.data?.sent ?? recipients.length - failed
      toast.warning(`Sent ${sent}, ${failed} failed`)
    } else {
      toast.success(
        `Email sent to ${recipients.length} ${recipients.length === 1 ? 'recipient' : 'recipients'}`
      )
    }
    setRecipients([])
    setSubject('')
    setBody('')
  }

  const patientsWithEmail = patientsList.filter(
    (p) => p.email && !recipients.some((r) => r.to === p.email)
  )

  const notConfigured = configured === false

  return (
    <div className="space-y-6">
      {notConfigured && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="font-medium">Email gateway not configured</p>
            <p className="text-muted-foreground">
              The Resend API key is missing on the server, so emails can't be sent. Add{' '}
              <code className="rounded bg-muted px-1 text-xs">RESEND_API_KEY</code> to enable
              sending.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Compose Email
          </CardTitle>
          <CardDescription>
            Send emails to patients via Resend. Use{' '}
            <code className="rounded bg-muted px-1 text-xs">{'{PatientName}'}</code> in the body to
            personalise.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email-subject">Subject</Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Your appointment reminder"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email-body">Message Body</Label>
            <Textarea
              id="email-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Dear {PatientName},&#10;&#10;..."
              rows={8}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Plain text is sent as-is. Wrap in HTML tags for rich formatting.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Add Recipients</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <PatientPicker
                  value={selectedPatientId}
                  onChange={(id) => setSelectedPatientId(id)}
                  patients={patientsWithEmail}
                  placeholder={
                    patientsWithEmail.length === 0
                      ? 'No patients with email found'
                      : 'Select a patient with an email'
                  }
                  disabled={patientsWithEmail.length === 0}
                />
              </div>
              <Button onClick={addRecipient} type="button">
                <Plus className="mr-2 h-4 w-4" />
                Add
              </Button>
            </div>
          </div>

          {recipients.length > 0 && (
            <div className="space-y-2">
              <Label>Recipients ({recipients.length})</Label>
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border p-3">
                {recipients.map((r) => (
                  <div
                    key={r.to}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-muted/50"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className="shrink-0">
                        {r.patientName}
                      </Badge>
                      <span className="truncate text-xs text-muted-foreground">{r.to}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => removeRecipient(r.to)}
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button
            onClick={handleSend}
            disabled={
              sending || notConfigured || !recipients.length || !subject.trim() || !body.trim()
            }
            className="w-full"
          >
            {sending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Mail className="mr-2 h-4 w-4" />
            )}
            Send Email to {recipients.length} {recipients.length === 1 ? 'Recipient' : 'Recipients'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
