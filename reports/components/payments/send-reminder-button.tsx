import { Bell, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { sendPaymentReminder } from '@/lib/actions/reminders'

interface SendReminderButtonProps {
  patientName: string
  patientPhone: string
  guardianPhone?: string | null
  isChild: boolean
  amountDue: number
}

export function SendReminderButton({
  patientName,
  patientPhone,
  guardianPhone,
  isChild,
  amountDue,
}: SendReminderButtonProps) {
  const [isSending, setIsSending] = useState(false)

  const handleSendReminder = async () => {
    setIsSending(true)
    try {
      const result = await sendPaymentReminder({
        patientName,
        patientPhone,
        guardianPhone,
        isChild,
        amountDue,
      })

      if (result.success) {
        toast.success('Reminder sent successfully')
      } else {
        toast.error(result.error || 'Failed to send reminder')
      }
    } catch (_error) {
      toast.error('An error occurred while sending the reminder')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSendReminder} disabled={isSending}>
      {isSending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Sending...
        </>
      ) : (
        <>
          <Bell className="mr-2 h-4 w-4" />
          Remind
        </>
      )}
    </Button>
  )
}
