import { Resend } from 'resend'
import { getEmailFrom } from './lib/branding'
import { logError, logger } from './lib/logger'

export type SendEmailOptions = {
  to: string | string[]
  subject: string
  html: string
  /** Defaults to the clinic's From — see getEmailFrom. */
  from?: string
}

/**
 * Send an email via Resend. Used for password resets; unlike lib/email.ts it
 * never records the message, because a reset email carries a live token.
 */
export async function sendEmail(
  options: SendEmailOptions,
  apiKey?: string
): Promise<{ success: boolean; error?: Error }> {
  const from = options.from || (await getEmailFrom())

  if (!apiKey) {
    logger.warn(
      { to: options.to, subject: options.subject },
      '[email] RESEND_API_KEY not set; skipping send.'
    )
    return { success: false, error: new Error('RESEND_API_KEY is not configured') }
  }

  const resend = new Resend(apiKey)

  try {
    const { error } = await resend.emails.send({
      from,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
    })
    if (error) {
      logError(error, { context: '[email] Resend error' })
      return { success: false, error: new Error(error.message) }
    }
    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    logError(error, { context: '[email] Send failed' })
    return { success: false, error }
  }
}
