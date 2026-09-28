import { api } from '@/lib/api-client'

/** A single email recipient + its rendered subject/body. */
export type EmailRecipient = {
  to: string
  subject: string
  html: string
  patientId?: string
}

export type EmailSendType = 'bulk' | 'followup' | 'birthday' | 'custom'

/** Per-recipient send outcome returned by the Resend gateway. */
export type EmailSendResult = {
  success: boolean
  /** Backend-level error (e.g. 503 when RESEND_API_KEY is absent). */
  error?: string
  sent?: number
  failed?: number
  total?: number
  results?: Array<{ to: string; status: 'sent' | string; error?: string }>
}

/** A row from the email send history. */
export type EmailHistoryRow = {
  id: string
  recipient: string
  subject: string
  type: string
  status: string
  sentAt: string
  error?: string | null
}

/**
 * POST /api/email/send — send one or more emails through the Resend gateway.
 * Returns the raw `ApiResponse` so the caller can `surfaceApiError` on failure
 * (the gateway answers 503 when RESEND_API_KEY is missing, 207 on partial sends).
 */
export async function sendEmail(
  recipients: EmailRecipient[],
  from?: string,
  type: EmailSendType = 'custom'
) {
  return api.post<EmailSendResult>('/api/email/send', { recipients, from, type })
}

export async function sendBulkEmail(payload: {
  subject: string
  html: string
  patientIds?: string[]
}) {
  return api.post<EmailSendResult>('/api/email/send-bulk', payload)
}

/** GET /api/email/status — email send history (most recent first). */
export async function getEmailStatus() {
  return api.get<EmailHistoryRow[]>('/api/email/status')
}

/**
 * Probe whether the Resend gateway is configured.
 *
 * The send endpoints answer `503` with an `Email service not configured`
 * error when `RESEND_API_KEY` is absent. We detect that by issuing a zero-cost
 * send (empty recipient list): when the key is missing the gateway short-circuits
 * to the 503 BEFORE the empty-recipients 400; when the key is present we get the
 * 400 (`No recipients provided`) — which tells us the gateway IS configured.
 */
export async function getEmailConfigStatus(): Promise<{
  configured: boolean
  /** True only when we could not determine the state (auth/network failure). */
  unknown?: boolean
}> {
  const res = await api.post<EmailSendResult>('/api/email/send', { recipients: [] })
  const error = res.error?.toLowerCase() ?? ''
  if (error.includes('not configured')) return { configured: false }
  // A "no recipients" 400 (or any success) means the key check already passed.
  if (error.includes('recipient') || res.success) return { configured: true }
  // 401/403/network — leave the banner off but flag the state as unknown.
  return { configured: false, unknown: true }
}
