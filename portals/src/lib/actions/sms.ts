import { api } from '@/lib/api-client'

export async function getUpcomingBirthdays() {
  return api.get<any[]>('/api/sms/upcoming-birthdays')
}

export async function getFollowupAppointments() {
  return api.get<any[]>('/api/sms/followup-appointments')
}

/**
 * `from` is the Hubtel Sender ID. Omit it to use the one configured in
 * Integrations — the server picks it; never default it to the clinic name,
 * which is not an approved Sender ID.
 */
export async function sendSMS(
  recipients: Array<{ phone: string; message: string; patientId?: string }>,
  from?: string,
  type: 'bulk' | 'birthday' | 'followup' | 'appointment' = 'bulk'
) {
  const res = await api.post<any>('/api/sms/send', { recipients, from, type })
  return res
}

export async function getFailedSMSMessages() {
  return api.get<any[]>('/api/sms/messages?status=failed')
}

export async function retrySMS(messageId: string) {
  const res = await api.post<any>(`/api/sms/retry/${messageId}`, {})
  return res
}

export async function getSentSMSMessages() {
  return api.get<any[]>('/api/sms/messages')
}

export async function getSMSStatus(messageId: string, isBatch: boolean = false) {
  return api.get<any>(`/api/sms/status/${messageId}?isBatch=${isBatch}`)
}
