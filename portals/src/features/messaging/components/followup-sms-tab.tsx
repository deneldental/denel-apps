import { format } from 'date-fns'
import { Loader2, Send } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { getFollowupAppointments, sendSMS } from '@/lib/actions/sms'
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

interface FollowupAppointment {
  appointmentId: string
  patientId: string
  patientName: string
  phone: string | null
  appointmentDate: Date
  appointmentType: string
}

const FOLLOWUP_APPOINTMENTS_KEY = ['messaging', 'sms', 'followup-appointments'] as const

export function FollowupSMSTab() {
  const branding = useBranding()
  const [from, setFrom] = useState(branding.smsSenderId)
  const [messageTemplate, setMessageTemplate] = useState(
    `Hello {{name}}, this is a follow-up from your recent {{type}} appointment on {{date}}. How are you feeling? Please reply if you have any concerns. - ${branding.name}`
  )
  const [sendingTo, setSendingTo] = useState<string | null>(null)
  // Sending doesn't change eligibility server-side, so "remove from list after
  // sending" is a client-only filter over the fetched list, not a refetch.
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())

  const appointmentsQuery = useApiQuery<FollowupAppointment[]>(
    FOLLOWUP_APPOINTMENTS_KEY,
    getFollowupAppointments
  )
  const appointments = (appointmentsQuery.data ?? []).filter((a) => !sentIds.has(a.appointmentId))
  const loadingAppointments = appointmentsQuery.isLoading

  const sendMutation = useApiMutation(
    (vars: {
      recipients: Array<{ phone: string; message: string; patientId?: string }>
      from: string
    }) => sendSMS(vars.recipients, vars.from, 'followup')
  )
  const isLoading = sendMutation.isPending

  const generateMessage = (appointment: FollowupAppointment) => {
    return messageTemplate
      .replace(/{{name}}/g, appointment.patientName)
      .replace(/{{type}}/g, appointment.appointmentType)
      .replace(/{{date}}/g, format(new Date(appointment.appointmentDate), 'MMM d, yyyy'))
  }

  const handleSend = async (appointment: FollowupAppointment) => {
    if (!appointment.phone) {
      toast.error('Patient does not have a phone number')
      return
    }

    setSendingTo(appointment.appointmentId)
    try {
      await sendMutation.mutateAsync({
        recipients: [
          {
            phone: appointment.phone,
            message: generateMessage(appointment),
            patientId: appointment.patientId,
          },
        ],
        from,
      })
      toast.success(`Follow-up SMS sent to ${appointment.patientName}`)
      setSentIds((prev) => new Set(prev).add(appointment.appointmentId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send SMS')
    } finally {
      setSendingTo(null)
    }
  }

  const handleSendAll = async () => {
    const appointmentsWithPhone = appointments.filter((a) => a.phone)

    if (appointmentsWithPhone.length === 0) {
      toast.error('No appointments with phone numbers to send SMS')
      return
    }

    const recipients = appointmentsWithPhone.map((appointment) => ({
      phone: appointment.phone!,
      message: generateMessage(appointment),
      patientId: appointment.patientId,
    }))

    try {
      await sendMutation.mutateAsync({ recipients, from })
      toast.success(`Follow-up SMS sent to ${recipients.length} patient(s)`)
      setSentIds((prev) => {
        const next = new Set(prev)
        for (const appointment of appointmentsWithPhone) next.add(appointment.appointmentId)
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
          <CardTitle>Follow-up SMS</CardTitle>
          <CardDescription>
            Send follow-up messages to patients who completed appointments in the last 7 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="from-followup">From (Sender Name)</Label>
            <Input
              id="from-followup"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder={branding.smsSenderId}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="message-template-followup">Message Template</Label>
            <Textarea
              id="message-template-followup"
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              placeholder="Hello {{name}}, this is a follow-up..."
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Use {'{{name}}'} for patient name, {'{{type}}'} for appointment type, and {'{{date}}'}{' '}
              for appointment date. {messageTemplate.length} characters.
            </p>
          </div>

          {loadingAppointments ? (
            <div className="text-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              <p className="text-muted-foreground">Loading follow-up appointments...</p>
            </div>
          ) : appointments.length === 0 ? (
            <div className="text-center py-8 border rounded-lg">
              <p className="text-muted-foreground">No completed appointments in the last 7 days.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {appointments.length} {appointments.length === 1 ? 'appointment' : 'appointments'}{' '}
                  for follow-up
                </p>
                <Button
                  onClick={handleSendAll}
                  disabled={isLoading || appointments.filter((a) => a.phone).length === 0}
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
                      <TableHead>Appointment Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {appointments.map((appointment) => (
                      <TableRow key={appointment.appointmentId}>
                        <TableCell className="font-medium">{appointment.patientName}</TableCell>
                        <TableCell>
                          {format(new Date(appointment.appointmentDate), "MMM d, yyyy 'at' h:mm a")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {appointment.appointmentType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {appointment.phone || (
                            <span className="text-muted-foreground">No phone</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            onClick={() => handleSend(appointment)}
                            disabled={
                              isLoading ||
                              !appointment.phone ||
                              sendingTo === appointment.appointmentId
                            }
                          >
                            {isLoading && sendingTo === appointment.appointmentId ? (
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
