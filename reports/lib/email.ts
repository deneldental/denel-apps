import { Resend } from 'resend'

const apiKey = process.env.RESEND_API_KEY
const resend = apiKey ? new Resend(apiKey) : null

const defaultFrom = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'

export type SendEmailOptions = {
  to: string | string[]
  subject: string
  html: string
  from?: string
}

/**
 * Send an email via Resend.
 * Requires RESEND_API_KEY in env (replace re_xxxxxxxxx with your real API key).
 */
export async function sendEmail({
  to,
  subject,
  html,
  from = defaultFrom,
}: SendEmailOptions): Promise<{ success: boolean; error?: Error }> {
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set; skipping send.', { to, subject })
    return { success: false, error: new Error('RESEND_API_KEY is not configured') }
  }

  try {
    const { error } = await resend.emails.send({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    })
    if (error) {
      console.error('[email] Resend error:', error)
      return { success: false, error: new Error(error.message) }
    }
    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    console.error('[email] Send failed:', error)
    return { success: false, error }
  }
}
