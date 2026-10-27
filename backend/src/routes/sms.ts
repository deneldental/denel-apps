import { and, eq, gte } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { appointments, smsMessages } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { recordCommsCost } from '../lib/comms-cost'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { getHubtelCredentials, sendSMS as sendSMSUtil } from '../lib/sms'
import { isRedactedSmsContent } from '../lib/sms-redaction'
import type { HonoEnv } from '../lib/types'

const smsApp = new Hono<HonoEnv>()

const MODULE = MODULES.MESSAGING

/** SMS log page size. The screens show the newest messages; the rest is bounded, not dumped. */
const MESSAGES_DEFAULT_LIMIT = 200
const MESSAGES_MAX_LIMIT = 500

function wholeNumber(raw: string | undefined): number | null {
  return raw !== undefined && /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : null
}

/** `?limit=&offset=` with safe fallbacks: a bad value means the default, never an error or an unbounded read. */
function pageParams(limitRaw: string | undefined, offsetRaw: string | undefined) {
  const requested = wholeNumber(limitRaw)
  const limit =
    requested !== null && requested >= 1
      ? Math.min(requested, MESSAGES_MAX_LIMIT)
      : MESSAGES_DEFAULT_LIMIT
  return { limit, offset: wholeNumber(offsetRaw) ?? 0 }
}

smsApp.get('/upcoming-birthdays', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const allPatients = await db.query.patients.findMany({
      columns: { id: true, name: true, phone: true, dob: true, isChild: true, guardianPhone: true },
    })

    const today = new Date()
    const BIRTHDAY_LOOKUP_DAYS = 30
    const upcomingBirthdays = []

    for (let i = 0; i < BIRTHDAY_LOOKUP_DAYS; i++) {
      const checkDate = new Date(today)
      checkDate.setDate(today.getDate() + i)
      const checkMonth = checkDate.getMonth() + 1
      const checkDay = checkDate.getDate()
      const checkYear = checkDate.getFullYear()

      const patientsWithBirthday = allPatients
        .filter((patient) => {
          if (!patient.dob) return false
          const dob = new Date(patient.dob)
          return dob.getMonth() + 1 === checkMonth && dob.getDate() === checkDay
        })
        .map((patient) => {
          const dob = new Date(patient.dob!)
          const contactPhone =
            patient.isChild && patient.guardianPhone ? patient.guardianPhone : patient.phone
          return {
            patientId: patient.id,
            patientName: patient.name || 'Unknown',
            phone: contactPhone,
            dateOfBirth: patient.dob,
            birthdayDate: `${checkYear}-${String(checkMonth).padStart(2, '0')}-${String(checkDay).padStart(2, '0')}`,
            daysUntil: i,
            age: checkYear - dob.getFullYear(),
          }
        })

      upcomingBirthdays.push(...patientsWithBirthday)
    }

    upcomingBirthdays.sort((a, b) => a.daysUntil - b.daysUntil)
    return c.json({ success: true, data: upcomingBirthdays })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch upcoming birthdays' }, 500)
  }
})

smsApp.get('/followup-appointments', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const completed = await db.query.appointments.findMany({
      where: and(eq(appointments.status, 'completed'), gte(appointments.date, sevenDaysAgo)),
      with: { patient: true },
      orderBy: (appointments, { desc }) => [desc(appointments.date)],
    })

    const followups = completed.map((a) => ({
      appointmentId: a.id,
      patientId: a.patientId,
      patientName: a.patient?.name || 'Unknown',
      phone:
        (a.patient?.isChild && a.patient?.guardianPhone
          ? a.patient.guardianPhone
          : a.patient?.phone) || null,
      appointmentDate: a.date,
      appointmentType: a.type || 'consultation',
    }))

    return c.json({ success: true, data: followups })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch followups' }, 500)
  }
})

// No balance route: Hubtel publishes no SMS-balance API (the address this used
// to call does not exist), so the portal points admins to the Hubtel dashboard.

smsApp.post('/send', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const { recipients, from, type } = await c.req.json()

    // Validate BEFORE accepting. The send is deferred to a background task
    // whose failures are swallowed by the catch below, so an unvalidated
    // request answered 202 "accepted" and then died silently — the caller was
    // told a batch was queued that never existed. Reject it here instead.
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return c.json({ error: 'recipients must be a non-empty array' }, 400)
    }

    // §13.5 — Background SMS processing
    setTimeout(async () => {
      try {
        const db = getDb(process.env.DATABASE_URL!)
        const CHUNK_SIZE = 500
        const chunks = []
        for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
          chunks.push(recipients.slice(i, i + CHUNK_SIZE))
        }

        let lastBatchId = 'N/A'

        for (const chunk of chunks) {
          const result = await sendSMSUtil(chunk, from, type, user.id)
          if (result.success && Array.isArray(chunk) && chunk.length > 0) {
            lastBatchId = (result as any).batchId || lastBatchId
            try {
              await recordCommsCost(db, {
                channel: 'sms',
                count: chunk.length,
                createdBy: user.id,
                reference: (result as { batchId?: string }).batchId,
              })
            } catch (costErr) {
              logError(costErr, { context: 'sms cost (non-fatal)' })
            }
          }
        }

        await createAuditLog(db, {
          userId: user.id,
          action: 'send_sms',
          module: 'messaging',
          entityId: lastBatchId,
          entityName: `SMS to ${recipients.length} recipients`,
          changes: { recipientsCount: recipients.length, type, from },
        })
      } catch (err) {
        logError(err as Error, { context: 'Background SMS chunking failed' })
      }
    }, 0)

    return c.json({ success: true, message: 'SMS batch accepted', status: 'accepted' }, 202)
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to queue SMS' }, 500)
  }
})

smsApp.get('/messages', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const status = c.req.query('status')
    const { limit, offset } = pageParams(c.req.query('limit'), c.req.query('offset'))

    const whereClause = status ? eq(smsMessages.status, status) : undefined

    // One extra row tells us whether another page exists without a count query.
    // Only the patient columns the screens show are joined: this log used to
    // return every patient's full record, for every message, unbounded.
    const rows = await db.query.smsMessages.findMany({
      where: whereClause,
      orderBy: (smsMessages, { desc }) => [desc(smsMessages.sentAt)],
      with: { patient: { columns: { id: true, name: true } } },
      limit: limit + 1,
      offset,
    })
    const hasMore = rows.length > limit
    return c.json({
      success: true,
      data: hasMore ? rows.slice(0, limit) : rows,
      pagination: { limit, offset, hasMore },
    })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch messages' }, 500)
  }
})

smsApp.get('/status/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const isBatch = c.req.query('isBatch') === 'true'

  if (id.startsWith('dev_')) {
    return c.json({
      success: true,
      data: {
        messageId: id,
        status: 'Delivered',
        recipient: 'Simulated Recipient',
        sentAt: new Date().toISOString(),
      },
    })
  }

  try {
    // The same account that sent the message — see getHubtelCredentials.
    const credentials = await getHubtelCredentials()
    if (!credentials) {
      return c.json({ error: 'Hubtel not configured' }, 500)
    }

    const authHeader = btoa(`${credentials.clientId}:${credentials.clientSecret}`)
    // `id` is caller input: encoded so it stays one path segment and cannot add
    // path or query parts to the Hubtel request.
    const segment = encodeURIComponent(id)
    const endpoint = isBatch
      ? `https://sms.hubtel.com/v1/messages/batch/${segment}`
      : `https://sms.hubtel.com/v1/messages/${segment}`

    const response = await fetch(endpoint, {
      headers: { Authorization: `Basic ${authHeader}` },
    })

    if (!response.ok) {
      return c.json({ error: 'Failed to fetch status from Hubtel' }, response.status as any)
    }

    const data = await response.json()
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to check status' }, 500)
  }
})

smsApp.post('/retry/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  // Resending costs money (it books a ledger expense), so it needs the same
  // permission as sending.
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const [message] = await db.select().from(smsMessages).where(eq(smsMessages.id, id)).limit(1)

    if (!message) return c.json({ error: 'Message not found' }, 404)

    // What is stored for a code or tokenised link is a stand-in, not the text
    // that was sent. Resending it would text the patient a message with the
    // secret cut out.
    if (isRedactedSmsContent(message.content)) {
      return c.json(
        {
          error: 'This message contained a one-time code or private link, so it cannot be resent.',
          code: 'SMS_REDACTED_NOT_RETRYABLE',
        },
        400
      )
    }

    const result = await sendSMSUtil(
      [
        {
          phone: message.recipient,
          message: message.content,
          patientId: message.patientId || undefined,
        },
      ],
      message.from || undefined,
      message.type as any,
      user.id
    )

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'retry_sms',
      module: 'messaging',
      entityId: id,
      entityName: `SMS to ${message.recipient}`,
    })

    // §13.5 — book the cost of the retried message (best-effort, posts to GL).
    if (result.success) {
      try {
        await recordCommsCost(db, {
          channel: 'sms',
          count: 1,
          createdBy: user.id,
          reference: `retry:${id}`,
        })
      } catch (costErr) {
        logError(costErr, { context: 'sms retry cost (non-fatal)' })
      }
    }

    return c.json(result)
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to retry SMS' }, 500)
  }
})

export { smsApp }
