import { getDb } from '../db'
import { emailMessages } from '../db/schema'
import { getEmailFrom } from './branding'
import { logError, logger } from './logger'

export interface EmailRecipient {
  to: string
  subject: string
  html: string
  patientId?: string
}

export async function sendEmail(
  env: {
    RESEND_API_KEY: string
    DATABASE_URL: string
  },
  recipients: EmailRecipient[],
  from?: string,
  type: 'bulk' | 'birthday' | 'followup' | 'custom' = 'bulk',
  sentById?: string
) {
  const { RESEND_API_KEY, DATABASE_URL } = env

  // An explicit caller From wins; otherwise the clinic's (see getEmailFrom).
  if (!from) from = await getEmailFrom()

  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not configured')
  }

  const db = getDb(DATABASE_URL)
  const results: { success: boolean; to: string; error?: string }[] = []

  // Resend supports batch sends — up to 100 per request
  const BATCH_SIZE = 100
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE)

    const isSingle = batch.length === 1

    const body = isSingle
      ? {
          from,
          to: [batch[0].to],
          subject: batch[0].subject,
          html: batch[0].html,
        }
      : batch.map((r) => ({
          from,
          to: [r.to],
          subject: r.subject,
          html: r.html,
        }))

    const endpoint = isSingle
      ? 'https://api.resend.com/emails'
      : 'https://api.resend.com/emails/batch'

    logger.debug({ endpoint, from, count: batch.length }, 'Sending email via Resend')

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logError(new Error('Resend API error'), { errorText, status: response.status })

        await db.insert(emailMessages).values(
          batch.map((r) => ({
            resendId: null,
            recipient: r.to,
            subject: r.subject,
            content: r.html,
            type,
            status: `failed: [${response.status}] ${errorText.substring(0, 80)}`,
            patientId: r.patientId ?? null,
            from,
            sentById: sentById ?? null,
          }))
        )

        batch.forEach((r) => results.push({ success: false, to: r.to, error: errorText }))
        continue
      }

      const result = (await response.json()) as any

      if (isSingle) {
        const resendId = result.id ?? null
        await db.insert(emailMessages).values({
          resendId,
          recipient: batch[0].to,
          subject: batch[0].subject,
          content: batch[0].html,
          type,
          status: 'sent',
          patientId: batch[0].patientId ?? null,
          from,
          sentById: sentById ?? null,
        })
        results.push({ success: true, to: batch[0].to })
      } else {
        // Batch response is an array of { id } objects
        const ids: Array<{ id: string }> = Array.isArray(result.data) ? result.data : []
        await db.insert(emailMessages).values(
          batch.map((r, idx) => ({
            resendId: ids[idx]?.id ?? null,
            recipient: r.to,
            subject: r.subject,
            content: r.html,
            type,
            status: 'sent',
            patientId: r.patientId ?? null,
            from,
            sentById: sentById ?? null,
          }))
        )
        batch.forEach((r) => results.push({ success: true, to: r.to }))
      }

      logger.info({ count: batch.length, type }, 'Emails sent via Resend')
    } catch (error: unknown) {
      logError(error, { action: 'sendEmail' })
      try {
        await db.insert(emailMessages).values(
          batch.map((r) => ({
            resendId: null,
            recipient: r.to,
            subject: r.subject,
            content: r.html,
            type,
            status: 'failed',
            patientId: r.patientId ?? null,
            from,
            sentById: sentById ?? null,
          }))
        )
      } catch (dbErr) {
        logError(dbErr as Error, { action: 'sendEmail_db_fallback' })
      }
      batch.forEach((r) =>
        results.push({
          success: false,
          to: r.to,
          error: error instanceof Error ? error.message : 'Email failed',
        })
      )
    }
  }

  const failed = results.filter((r) => !r.success)
  return {
    success: failed.length === 0,
    sent: results.filter((r) => r.success).length,
    failed: failed.length,
    results,
  }
}
