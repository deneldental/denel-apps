import { formatCurrency } from '@denel/utils'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { smsMessages } from '../db/schema'
import { clinicSettings } from '../db/schema/operations'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { sendSMS } from '../lib/sms'
import type { HonoEnv } from '../lib/types'

const DEFAULT_COOLDOWN_HOURS = 24

const remindersApp = new Hono<HonoEnv>()

// GET /api/reminders/payment/cooldown-status
// Returns the timestamp of the last successful payment_reminder SMS per phone,
// plus the configured cooldown window. Used by the dashboard to gate the
// "Remind" button without spamming patients.
remindersApp.get('/payment/cooldown-status', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const phonesParam = c.req.query('phones') ?? ''
  const phones = phonesParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const db = getDb(process.env.DATABASE_URL!)

  // Read cooldown from settings kv (default 24 h if not set)
  let cooldownHours = DEFAULT_COOLDOWN_HOURS
  try {
    const [setting] = await db
      .select({ value: clinicSettings.value })
      .from(clinicSettings)
      .where(eq(clinicSettings.key, 'reminder_payment_cooldown_hours'))
      .limit(1)
    if (setting?.value) {
      const parsed = Number(setting.value)
      if (!Number.isNaN(parsed) && parsed > 0) cooldownHours = parsed
    }
  } catch {
    // non-critical — fall back to default
  }

  // Build last-sent map
  const lastSentMap: Record<string, string | null> = {}
  phones.forEach((p) => {
    lastSentMap[p] = null
  })

  if (phones.length > 0) {
    try {
      const rows = await db
        .select({ recipient: smsMessages.recipient, sentAt: smsMessages.sentAt })
        .from(smsMessages)
        .where(
          and(
            eq(smsMessages.type, 'payment_reminder'),
            eq(smsMessages.status, 'sent'),
            inArray(smsMessages.recipient, phones)
          )
        )
        .orderBy(desc(smsMessages.sentAt))

      // First occurrence per phone (DESC order → latest first)
      for (const row of rows) {
        if (lastSentMap[row.recipient] === null) {
          lastSentMap[row.recipient] = row.sentAt.toISOString()
        }
      }
    } catch (error) {
      logError(error, { route: 'reminders.cooldown-status', userId: user.id })
    }
  }

  return c.json({ success: true, data: { lastSentMap, cooldownHours } })
})

// POST /api/reminders/payment
remindersApp.post('/payment', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.SMS as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { patientName, patientPhone, amountDue, isChild, guardianPhone } = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const recipientPhone = isChild && guardianPhone ? guardianPhone : patientPhone
    if (!recipientPhone) return c.json({ error: 'No phone' }, 400)

    const formattedAmount = formatCurrency(amountDue)

    const message = `Dear ${patientName}, this is a gentle reminder about your outstanding payment of ${formattedAmount}. Please contact Denel Dental Clinic to arrange payment. Thank you!`

    const result = await sendSMS([{ phone: recipientPhone, message }])

    // Always persist — even on failure — so the admin can see the attempt.
    await db.insert(smsMessages).values({
      recipient: recipientPhone,
      content: message,
      type: 'payment_reminder',
      status: result.success ? 'sent' : 'failed',
      from: 'Denel',
      sentById: user.id,
    })

    if (!result.success) {
      logError(result.error, { route: 'reminders.payment', userId: user.id, recipientPhone })
      return c.json({ error: 'SMS send failed', code: 'SMS_SEND_FAILED' }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    logError(error, { route: 'reminders.payment', userId: user.id })
    return c.json({ error: 'Failed to send reminder', code: 'REMINDER_FAILED' }, 500)
  }
})

export { remindersApp }
