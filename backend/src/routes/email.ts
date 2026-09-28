import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { emailMessages, patients } from '../db/schema'
import { recordCommsCost } from '../lib/comms-cost'
import { sendEmail } from '../lib/email'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

/**
 * §13.5 — book the cost of an email send as a Communications expense
 * (best-effort, non-blocking). `sent` is the count of emails the gateway
 * actually accepted; a cost-tracking failure must NEVER fail the send, so this
 * swallows everything.
 */
async function bookEmailCost(
  db: ReturnType<typeof getDb>,
  sent: number,
  userId: string
): Promise<void> {
  if (sent <= 0) return
  try {
    await recordCommsCost(db, { channel: 'email', count: sent, createdBy: userId })
  } catch (err) {
    logError(err, { context: 'email cost (non-fatal)' })
  }
}

const emailApp = new Hono<HonoEnv>()
const MODULE = MODULES.MESSAGING

// ── GET /api/email/status ─────────────────────────────────────────────────────
// Returns email send history

emailApp.get('/status', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const limit = Number(c.req.query('limit') ?? 100)
  const offset = Number(c.req.query('offset') ?? 0)

  const rows = await db
    .select()
    .from(emailMessages)
    .orderBy(desc(emailMessages.sentAt))
    .limit(limit)
    .offset(offset)

  return c.json({ success: true, data: rows })
})

// ── POST /api/email/send ──────────────────────────────────────────────────────
// Send email to one or more patients / arbitrary addresses

emailApp.post('/send', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  if (!process.env.RESEND_API_KEY) {
    return c.json({ error: 'Email service not configured (RESEND_API_KEY missing)' }, 409)
  }

  const body = await c.req.json<{
    recipients: Array<{ to: string; subject: string; html: string; patientId?: string }>
    from?: string
    type?: 'bulk' | 'followup' | 'birthday' | 'custom'
  }>()

  if (!body.recipients?.length) {
    return c.json({ error: 'No recipients provided' }, 400)
  }

  // Validate each recipient has required fields
  for (const r of body.recipients) {
    if (!r.to || !r.subject || !r.html) {
      return c.json({ error: 'Each recipient must have to, subject, and html' }, 400)
    }
  }

  const result = await sendEmail(
    { RESEND_API_KEY: process.env.RESEND_API_KEY, DATABASE_URL: process.env.DATABASE_URL! },
    body.recipients,
    body.from,
    body.type ?? 'custom',
    user.id
  )

  // §13.5 — book the send cost (best-effort, on accepted emails only).
  await bookEmailCost(getDb(process.env.DATABASE_URL!), result.sent, user.id)

  return c.json(result, result.success ? 200 : 207)
})

// ── POST /api/email/send-bulk ─────────────────────────────────────────────────
// Send same subject + body to all patients with an email address

emailApp.post('/send-bulk', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  if (!process.env.RESEND_API_KEY) {
    return c.json({ error: 'Email service not configured (RESEND_API_KEY missing)' }, 409)
  }

  const { subject, html, patientIds } = await c.req.json<{
    subject: string
    html: string
    patientIds?: string[] // if empty, sends to all patients with an email
  }>()

  if (!subject || !html) {
    return c.json({ error: 'subject and html are required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)

  let targetPatients
  if (patientIds?.length) {
    targetPatients = await db
      .select({ id: patients.id, email: patients.email, name: patients.name })
      .from(patients)
      .where(eq(patients.id, patientIds[0])) // drizzle inArray workaround below
    // Use inArray for full list
    const { inArray } = await import('drizzle-orm')
    targetPatients = await db
      .select({ id: patients.id, email: patients.email, name: patients.name })
      .from(patients)
      .where(inArray(patients.id, patientIds))
  } else {
    targetPatients = await db
      .select({ id: patients.id, email: patients.email, name: patients.name })
      .from(patients)
  }

  const recipients = targetPatients
    .filter((p) => !!p.email)
    .map((p) => ({
      to: p.email!,
      subject,
      html: html.replace(/\{PatientName\}/g, p.name),
      patientId: p.id,
    }))

  if (!recipients.length) {
    return c.json({ success: false, error: 'No patients with email addresses found' }, 400)
  }

  const result = await sendEmail(
    { RESEND_API_KEY: process.env.RESEND_API_KEY, DATABASE_URL: process.env.DATABASE_URL! },
    recipients,
    undefined,
    'bulk',
    user.id
  )

  // §13.5 — book the send cost (best-effort, on accepted emails only).
  await bookEmailCost(db, result.sent, user.id)

  return c.json({ ...result, total: recipients.length }, result.success ? 200 : 207)
})

export { emailApp }
