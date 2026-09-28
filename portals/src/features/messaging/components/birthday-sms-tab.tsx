import { format } from 'date-fns'
import { Loader2, Send } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { getUpcomingBirthdays, sendSMS } from '@/lib/actions/sms'
import { useBranding } from '@/lib/branding-context'
import { useApiMutation, useApiQuery } from '@/lib/query'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'

interface BirthdayPatient {
  patientId: string
  patientName: string
  phone: string | null
  dateOfBirth: Date | null
  birthdayDate: string
  daysUntil: number
  age: number
}

const BIRTHDAYS_KEY = ['messaging', 'sms', 'birthdays'] as const

export function BirthdaySMSTab() {
  const branding = useBranding()
  const [from, setFrom] = useState(branding.smsSenderId)
  const [messageTemplate, setMessageTemplate] = useState(
    `Happy Birthday {{name}}! Wishing you a wonderful day filled with joy and happiness. - ${branding.name}`
  )
  const [sendingTo, setSendingTo] = useState<string | null>(null)
  // Sending doesn't change eligibility server-side, so "remove from list after
  // sending" is a client-only filter over the fetched list, not a refetch.
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())

  const birthdaysQuery = useApiQuery<BirthdayPatient[]>(BIRTHDAYS_KEY, getUpcomingBirthdays)
  const birthdays = (birthdaysQuery.data ?? []).filter((b) => !sentIds.has(b.patientId))
  const loadingBirthdays = birthdaysQuery.isLoading

  const sendMutation = useApiMutation(
    (vars: {
      recipients: Array<{ phone: string; message: string; patientId?: string }>
      from: string
    }) => sendSMS(vars.recipients, vars.from, 'birthday')
  )
  const isLoading = sendMutation.isPending

  const generateMessage = (patient: BirthdayPatient) => {
    return messageTemplate
      .replace(/{{name}}/g, patient.patientName)
      .replace(/{{age}}/g, patient.age.toString())
  }

  const handleSend = async (patient: BirthdayPatient) => {
    if (!patient.phone) {
      toast.error('Patient does not have a phone number')
      return
    }

    setSendingTo(patient.patientId)
    try {
      await sendMutation.mutateAsync({
        recipients: [
          { phone: patient.phone, message: generateMessage(patient), patientId: patient.patientId },
        ],
        from,
      })
      toast.success(`Birthday SMS sent to ${patient.patientName}`)
      setSentIds((prev) => new Set(prev).add(patient.patientId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send SMS')
    } finally {
      setSendingTo(null)
    }
  }

  const handleSendAll = async () => {
    const patientsWithPhone = birthdays.filter((b) => b.phone)

    if (patientsWithPhone.length === 0) {
      toast.error('No patients with phone numbers to send SMS')
      return
    }

    const recipients = patientsWithPhone.map((patient) => ({
      phone: patient.phone!,
      message: generateMessage(patient),
      patientId: patient.patientId,
    }))

    try {
      await sendMutation.mutateAsync({ recipients, from })
      toast.success(`Birthday SMS sent to ${recipients.length} patient(s)`)
      setSentIds((prev) => {
        const next = new Set(prev)
        for (const patient of patientsWithPhone) next.add(patient.patientId)
        return next
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send SMS')
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Birthday SMS</CardTitle>
          <CardDescription>
            Send birthday wishes to patients with upcoming birthdays (next 30 days).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="from-birthday">From (Sender Name)</Label>
            <Input
              id="from-birthday"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder={branding.smsSenderId}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="message-template">Message Template</Label>
            <Textarea
              id="message-template"
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              placeholder="Happy Birthday {{name}}! ..."
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Use {'{{name}}'} for patient name and {'{{age}}'} for age. {messageTemplate.length}{' '}
              characters.
            </p>
          </div>

          {loadingBirthdays ? (
            <div className="text-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              <p className="text-muted-foreground">Loading upcoming birthdays...</p>
            </div>
          ) : birthdays.length === 0 ? (
            <div className="text-center py-8 border rounded-lg">
              <p className="text-muted-foreground">No upcoming birthdays in the next 30 days.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {birthdays.length} upcoming {birthdays.length === 1 ? 'birthday' : 'birthdays'}
                </p>
                <Button
                  onClick={handleSendAll}
                  disabled={isLoading || birthdays.filter((b) => b.phone).length === 0}
                  size="sm"
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send All
                </Button>
              </div>

              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient</TableHead>
                      <TableHead>Birthday</TableHead>
                      <TableHead>Days Until</TableHead>
                      <TableHead>Age</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {birthdays.map((patient) => (
                      <TableRow key={patient.patientId}>
                        <TableCell className="font-medium">{patient.patientName}</TableCell>
                        <TableCell>
                          {format(new Date(patient.birthdayDate), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell>
                          <Badge variant={patient.daysUntil === 0 ? 'default' : 'secondary'}>
                            {patient.daysUntil === 0
                              ? 'Today'
                              : `${patient.daysUntil} day${patient.daysUntil === 1 ? '' : 's'}`}
                          </Badge>
                        </TableCell>
                        <TableCell>{patient.age} years</TableCell>
                        <TableCell>
                          {patient.phone || <span className="text-muted-foreground">No phone</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            onClick={() => handleSend(patient)}
                            disabled={
                              isLoading || !patient.phone || sendingTo === patient.patientId
                            }
                          >
                            {isLoading && sendingTo === patient.patientId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Send className="h-4 w-4 mr-2" />
                                Send
                              </>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
