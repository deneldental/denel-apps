import { api } from '@/lib/api-client'

interface SendPaymentReminderParams {
  patientName: string
  patientPhone: string
  amountDue: number
  isChild: boolean
  guardianPhone?: string | null
}

export async function sendPaymentReminder(params: SendPaymentReminderParams) {
  return api.post<any>('/api/reminders/payment', params)
}
