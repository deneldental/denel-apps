import { env, isDevEnvironment, resolvedEnvironment } from '../config/env'
import { getDb } from '../db'
import { smsMessages } from '../db/schema'
import { getBranding } from './branding'
import { getHubtelConfig, type HubtelConfig } from './integrations'
import { logError, logger } from './logger'
import { formatPhoneNumber } from './utils/phone'

export interface SMSRecipient {
  phone: string
  message: string
  patientId?: string
  patientName?: string
}

export type HubtelCredentials = { clientId: string; clientSecret: string }

/** Integrations keys first, the environment as the fallback. */
function credentialsFrom(hubtel: HubtelConfig | null): HubtelCredentials | null {
  const clientId = hubtel?.clientId || env.HUBTEL_CLIENT_ID
  const clientSecret = hubtel?.clientSecret || env.HUBTEL_CLIENT_SECRET
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/**
 * The Hubtel account every SMS path uses — sending, delivery-status checks and
 * the Integrations test — so they can never disagree about which one is live.
 */
export async function getHubtelCredentials(): Promise<HubtelCredentials | null> {
  return credentialsFrom(await getHubtelConfig().catch(() => null))
}

export async function sendSMS(
  recipients: SMSRecipient[],
  from?: string,
  type:
    | 'bulk'
    | 'birthday'
    | 'followup'
    | 'appointment'
    | 'task'
    | 'attendance'
    | 'memo'
    | 'test' = 'bulk',
  sentById?: string
) {
  const hubtel = await getHubtelConfig().catch(() => null)
  const credentials = credentialsFrom(hubtel)
  const DATABASE_URL = env.DATABASE_URL

  // Sender ID resolution:
  //   - Explicit non-default caller value wins
  //   - Hubtel KV senderId (admin set it explicitly)
  //   - Branding KV smsSenderId
  //   - Hardcoded fallback baked into branding's literal defaults
  // Call sites pass `undefined` and let this resolve. The legacy hardcoded
  // 'Framada' is still treated as "use configured value" so any caller that
  // predates that change (or a stored value) still picks up admin branding.
  let resolvedFrom = from
  if (!resolvedFrom || resolvedFrom === 'Framada') {
    if (hubtel?.senderId) {
      resolvedFrom = hubtel.senderId
    } else {
      const branding = await getBranding().catch(() => null)
      resolvedFrom = branding?.smsSenderId ?? 'Denel'
    }
  }
  from = resolvedFrom

  const isDev = isDevEnvironment()
  const isProd = resolvedEnvironment() === 'production'
  // Local development never texts a real recipient: everything goes to
  // SMS_REDIRECT_PHONE, and without one nothing is sent at all (see below).
  const redirectPhone = isDev ? env.SMS_REDIRECT_PHONE?.trim() || undefined : undefined

  // 1. Process recipients: variable substitution and redirectPhone.
  const resolvedRecipients = recipients.map((r) => {
    let msg = r.message
    if (msg.includes('{{firstName}}')) {
      const firstName = r.patientName ? r.patientName.split(' ')[0] : 'Valued Patient'
      msg = msg.replace(/\{\{firstName\}\}/g, firstName)
    }
    if (msg.includes('{{clinicName}}')) {
      const clinicName = from || 'Our Clinic'
      msg = msg.replace(/\{\{clinicName\}\}/g, clinicName)
    }

    if (redirectPhone) {
      msg = `[Dev redirect from ${r.phone}] ${msg}`
      return { ...r, message: msg, phone: redirectPhone }
    }
    return { ...r, message: msg }
  })

  // E2E test stub — when SMS_STUB_FILE is set, append every outgoing message
  // to that file (NDJSON) and return success WITHOUT calling Hubtel. The test
  // harness reads from this file to capture OTP codes. NEVER honored in
  // production: the env-var presence check is enough since SMS_STUB_FILE will
  // never be set in the prod Doppler config.
  const SMS_STUB_FILE = process.env.SMS_STUB_FILE
  if (SMS_STUB_FILE && !isProd) {
    const fs = await import('node:fs')
    const ts = new Date().toISOString()
    for (const r of resolvedRecipients) {
      fs.appendFileSync(
        SMS_STUB_FILE,
        `${JSON.stringify({ ts, phone: r.phone, message: r.message, from, type, patientId: r.patientId ?? null })}\n`
      )
    }
    logger.info(
      { count: resolvedRecipients.length, file: SMS_STUB_FILE },
      '[SMS STUB] captured outgoing'
    )
    return { success: true, data: { stubbed: true } }
  }

  // Simulate instead of sending — log the messages and return success so the
  // scheduler can still mark reminders as sent and the UI shows feedback — when
  // there are no Hubtel credentials (dev/staging only; production refuses), or
  // in local development with no SMS_REDIRECT_PHONE to send to.
  if (!credentials || (isDev && !redirectPhone)) {
    if (!credentials && isProd) throw new Error('Hubtel credentials not configured')
    const reason = credentials ? 'SMS_REDIRECT_PHONE is not set' : 'No Hubtel credentials'

    logger.info(
      {
        reason,
        recipients: resolvedRecipients.map((r) => ({
          phone: r.phone,
          patientId: r.patientId,
          preview: r.message.slice(0, 80),
        })),
      },
      `[SMS DEV] ${reason} — simulated send`
    )
    console.log(`\n[SMS DEV MODE] ${reason} — would send the following messages:`)
    for (const r of resolvedRecipients) {
      console.log(`  To: ${r.phone}${r.patientId ? ` (patient ${r.patientId})` : ''}`)
      console.log(`  Message: ${r.message}`)
    }
    console.log('[SMS DEV MODE] ─────────────────────────────────────────\n')

    // Record as dev-simulated so it's visible in the sms_messages log
    const db = getDb(DATABASE_URL)
    await db.insert(smsMessages).values(
      resolvedRecipients.map((r) => ({
        batchId: 'DEV_SIMULATED',
        messageId: `dev_${Date.now()}`,
        recipient: r.phone,
        content: r.message,
        type,
        status: 'dev_simulated',
        patientId: r.patientId ?? null,
        from,
        sentById: sentById ?? null,
      }))
    )
    return { success: true, data: { simulated: true, reason } }
  }

  const isSingle = resolvedRecipients.length === 1
  const endpoint = isSingle
    ? 'https://sms.hubtel.com/v1/messages/send'
    : 'https://sms.hubtel.com/v1/messages/batch/personalized/send'

  const body = isSingle
    ? {
        From: from,
        To: formatPhoneNumber(resolvedRecipients[0].phone),
        Content: resolvedRecipients[0].message,
      }
    : {
        From: from,
        personalizedRecipients: resolvedRecipients.map((r) => ({
          To: formatPhoneNumber(r.phone),
          Content: r.message,
        })),
      }

  const authHeader = btoa(`${credentials.clientId}:${credentials.clientSecret}`)

  console.log(
    `[SMS DEBUG] Sending to ${endpoint} | From: ${from} | To: ${isSingle ? (body as any).To : 'MULTIPLE'}`
  )
  logger.debug(
    { endpoint, from, recipientCount: resolvedRecipients.length },
    'Sending SMS to Hubtel'
  )

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${authHeader}`,
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    })

    const db = getDb(DATABASE_URL)

    if (!response.ok) {
      const errorText = await response.text()
      logError(new Error('Hubtel API error'), { errorText, status: response.status })

      // Track failure
      await db.insert(smsMessages).values(
        resolvedRecipients.map((r) => ({
          batchId: 'FAILED',
          messageId: 'FAILED',
          recipient: r.phone,
          content: r.message,
          type: type,
          status: `failed: [${response.status}] ${errorText.substring(0, 40) || 'Unknown error'}`,
          patientId: r.patientId || null,
          from: from,
          sentById: sentById || null,
        }))
      )

      return { success: false, error: 'Hubtel API error', details: errorText }
    }

    const result = (await response.json()) as any
    logger.debug({ result, isSingle }, 'Hubtel API response received')

    if (isSingle) {
      // Single message response handling
      const messageId =
        result.messageId || result.data?.messageId || result.id || result.message_id || 'UNKNOWN'
      const status =
        result.status === 'success' || result.status === 'sent' || result.status === 'Scheduled'
          ? 'sent'
          : result.status || 'sent'

      await db.insert(smsMessages).values({
        batchId: null,
        messageId: messageId,
        recipient: resolvedRecipients[0].phone,
        content: resolvedRecipients[0].message,
        type: type,
        status: status,
        patientId: resolvedRecipients[0].patientId || null,
        from: from,
        sentById: sentById || null,
      })
    } else {
      // Batch message response handling
      const batchId = result.batchId || result.id || result.batch_id
      const messages = result.messages || result.data?.messages || []

      if (messages.length > 0 && messages.length === resolvedRecipients.length) {
        await db.insert(smsMessages).values(
          messages.map((msg: any, index: number) => ({
            batchId: batchId,
            messageId: msg.messageId || msg.id || msg.message_id,
            recipient: resolvedRecipients[index].phone,
            content: resolvedRecipients[index].message,
            type: type,
            status: msg.status || 'sent',
            patientId: resolvedRecipients[index].patientId || null,
            from: from,
            sentById: sentById || null,
          }))
        )
      } else {
        await db.insert(smsMessages).values(
          resolvedRecipients.map((recipient, index) => {
            const msg = messages?.[index]
            return {
              batchId: batchId || 'BATCH',
              messageId: msg?.messageId || msg?.id || result.messageId || result.id || null,
              recipient: recipient.phone,
              content: recipient.message,
              type: type,
              status: msg?.status || 'sent',
              patientId: recipient.patientId || null,
              from: from,
              sentById: sentById || null,
            }
          })
        )
      }
    }

    logger.info({ recipientCount: resolvedRecipients.length, type }, 'SMS sent successfully')
    console.log(`[SMS SUCCESS] Hubtel accepted the message(s)`)
    return { success: true, data: result }
  } catch (error: unknown) {
    logError(error, { action: 'sendSMS' })

    // CRITICAL: Try to log the failure to the DB so it's visible in the UI
    try {
      const db = getDb(DATABASE_URL)
      await db.insert(smsMessages).values(
        resolvedRecipients.map((r) => ({
          batchId: 'ERROR',
          messageId: 'ERROR',
          recipient: r.phone,
          content: r.message,
          type: type,
          status: 'failed',
          patientId: r.patientId || null,
          from: from,
          sentById: sentById || null,
        }))
      )
    } catch (dbError) {
      logError(dbError as Error, { action: 'sendSMS_db_fallback' })
    }

    return { success: false, error: error instanceof Error ? error.message : 'SMS failed' }
  }
}
