import { Loader2, Mail, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { sendEmail } from '@/lib/actions/email'
import { getPatients } from '@/lib/actions/patients'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { PatientPicker } from '@/shared/components/patient-picker'
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

interface Recipient {
  to: string
  subject: string
  html: string
  patientId?: string
  patientName?: string
}

export function BulkEmailTab() {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [selectedPatientId, setSelectedPatientId] = useState('')

  const patientsQuery = useApiQuery<any[]>(queryKeys.patients.list(), () => getPatients())
  const patientsList = patientsQuery.data ?? []

  const sendMutation = useApiMutation(
    (vars: {
      recipients: Array<{ to: string; subject: string; html: string; patientId?: string }>
    }) => sendEmail(vars.recipients, undefined, 'bulk')
  )
  const isLoading = sendMutation.isPending

  function addRecipient() {
    if (!selectedPatientId) {
      toast.error('Select a patient')
      return
    }
    const patient = patientsList.find((p) => p.id === selectedPatientId)
    if (!patient) return
    if (!patient.email) {
      toast.error(`${patient.name} has no email address`)
      return
    }
    if (recipients.some((r) => r.to === patient.email)) {
      toast.error('Patient already added')
      return
    }
    setRecipients([
      ...recipients,
      {
        to: patient.email,
        subject,
        html: body || '',
        patientId: patient.id,
        patientName: patient.name,
      },
    ])
    setSelectedPatientId('')
  }

  function removeRecipient(to: string) {
    setRecipients(recipients.filter((r) => r.to !== to))
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

    const finalRecipients = recipients.map((r) => ({
      to: r.to,
      subject,
      html: body.replace(/\{PatientName\}/g, r.patientName ?? ''),
      patientId: r.patientId,
    }))

    try {
      await sendMutation.mutateAsync({ recipients: finalRecipients })
      toast.success(`Email sent to ${recipients.length} recipient(s)`)
      setRecipients([])
      setSubject('')
      setBody('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send emails')
    }
  }

  const patientsWithEmail = patientsList.filter(
    (p) => p.email && !recipients.some((r) => r.to === p.email)
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Bulk Email
          </CardTitle>
          <CardDescription>
            Send emails to patients via Resend. Use{' '}
            <code className="text-xs bg-muted px-1 rounded">{'{PatientName}'}</code> in the body to
            personalise.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Your appointment reminder"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Message Body</Label>
            <Textarea
              id="body"
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
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
          </div>

          {recipients.length > 0 && (
            <div className="space-y-2">
              <Label>Recipients ({recipients.length})</Label>
              <div className="space-y-1 max-h-52 overflow-y-auto border rounded-lg p-3">
                {recipients.map((r) => (
                  <div
                    key={r.to}
                    className="flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className="shrink-0">
                        {r.patientName}
                      </Badge>
                      <span className="text-xs text-muted-foreground truncate">{r.to}</span>
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
            disabled={isLoading || !recipients.length || !subject.trim() || !body.trim()}
            className="w-full"
          >
            {isLoading ? (
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
