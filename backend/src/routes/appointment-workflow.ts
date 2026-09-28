/**
 * Appointment workflow routes — Phase 1.5
 *
 * Handles:
 * - Status transitions (check-in, in-chair, complete, no-show)
 * - Confirmation token generation + SMS dispatch
 * - Public confirmation landing endpoint (no auth — token-based)
 */

import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { appointments } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { enrichAppointment, syncAppointmentUpdated } from '../lib/google-calendar'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { createRateLimiter, requireClientIp } from '../lib/rate-limiter'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { sendSMS } from '../lib/sms'
import { renderSms, resolveSmsTemplate } from '../lib/sms-templates'
import type { HonoEnv } from '../lib/types'

const appointmentWorkflowApp = new Hono<HonoEnv>()

const STATUS_TRANSITIONS: Record<string, { status: string; timestampField?: string }> = {
  'check-in': { status: 'checked_in', timestampField: 'checkedInAt' },
  seat: { status: 'in_chair', timestampField: 'inChairAt' },
  complete: { status: 'completed', timestampField: 'completedAt' },
  'no-show': { status: 'no_show' },
  cancel: { status: 'cancelled' },
}

// ─── PATCH /api/appointment-workflow/:id/transition ──────────────────────────
// Body: { action: 'check-in' | 'seat' | 'complete' | 'no-show' | 'cancel' }
appointmentWorkflowApp.patch('/:id/transition', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.APPOINTMENTS as string, ACTIONS.UPDATE as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = await c.req.json()
  const action = body.action as string
  const incomingNote = typeof body.notes === 'string' ? body.notes.trim() : ''

  const transition = STATUS_TRANSITIONS[action]
  if (!transition) return c.json({ error: `Invalid action: ${action}` }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const updates: any = { status: transition.status, updatedAt: new Date() }
  if (transition.timestampField) {
    updates[transition.timestampField] = new Date()
  }

  // Estimate routing (0168): a requires-estimate visit enters the doctor's
  // Activity queue on check-in (awaiting_estimate) rather than reception-direct.
  if (transition.status === 'checked_in') {
    const appt = await db.query.appointments.findFirst({
      where: eq(appointments.id, id),
      columns: { requiresEstimate: true, estimateStatus: true },
    })
    if (appt?.requiresEstimate && !appt.estimateStatus) {
      updates.estimateStatus = 'awaiting_estimate'
    }
  }

  // Append a timestamped note when provided (e.g. no-show "last response from patient")
  if (incomingNote) {
    const existing = await db.query.appointments.findFirst({
      where: eq(appointments.id, id),
      columns: { notes: true },
    })
    const stamp = `[${transition.status} ${new Date().toISOString()}]: ${incomingNote}`
    updates.notes = existing?.notes ? `${existing.notes}\n${stamp}` : stamp
  }

  try {
    const [updated] = await db
      .update(appointments)
      .set(updates)
      .where(eq(appointments.id, id))
      .returning()
    if (!updated) return c.json({ error: 'Appointment not found' }, 404)

    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'appointments',
      entityId: id,
      entityName: `Appointment transition → ${transition.status}`,
      changes: updates,
    })

    // Sync status change to Google Calendar — sync helper deletes the event
    // if the new status is cancelled / no_show, patches it otherwise.
    enrichAppointment(updated)
      .then((enriched) => syncAppointmentUpdated(enriched))
      .catch((err) => logError(err, { route: 'appointment-workflow.transition.sync' }))

    return c.json({ success: true, data: updated })
  } catch (error) {
    logError(error, { route: 'appointment-workflow.transition' })
    return c.json({ error: 'Failed to transition', code: 'WORKFLOW_TRANSITION_FAILED' }, 500)
  }
})

// ─── POST /api/appointment-workflow/:id/send-confirmation ───────────────────
// Generates/rotates a confirmation token and sends a reminder SMS with the confirmation URL.
appointmentWorkflowApp.post('/:id/send-confirmation', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.APPOINTMENTS as string, ACTIONS.UPDATE as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, id),
    with: { patient: true, doctor: { with: { user: true } } },
  })
  if (!appt) return c.json({ error: 'Appointment not found' }, 404)

  // Generate new token (rotate on each send)
  const token = crypto.randomUUID()
  const baseUrl = process.env.PORTAL_URL ?? 'https://app.deneldental.com'
  const confirmationUrl = `${baseUrl}/c/${token}`

  const patientPhone =
    appt.patient?.isChild && appt.patient?.guardianPhone
      ? appt.patient.guardianPhone
      : appt.patient?.phone
  if (!patientPhone) return c.json({ error: 'Patient has no phone number' }, 400)

  const apptDate = new Date(appt.date)
  const doctorName = (appt.doctor as any)?.user?.name || 'your doctor'
  const template = await resolveSmsTemplate(
    db,
    'appointment:confirm_link',
    'Hi {name}, reminder: appointment at {ClinicName} on {date} at {time} with {doctor}. Confirm or cancel: {url}'
  )
  const message = renderSms(template, {
    name: appt.patient?.name || 'Patient',
    ClinicName: process.env.CLINIC_NAME || 'Denel',
    date: apptDate.toLocaleDateString(),
    time: apptDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    doctor: doctorName,
    url: confirmationUrl,
  })

  // Save token first so the URL is valid before SMS fires
  await db
    .update(appointments)
    .set({
      confirmationToken: token,
      confirmationSentAt: new Date(),
      confirmationResponse: null,
      confirmationRespondedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(appointments.id, id))

  // Send SMS
  const smsResult = await sendSMS(
    [{ phone: patientPhone, message, patientId: appt.patient?.id }],
    undefined,
    'appointment',
    user.id
  )

  await createAuditLog(db, {
    userId: user.id,
    action: 'update',
    module: 'appointments',
    entityId: id,
    entityName: `Confirmation SMS ${smsResult.success ? 'sent' : 'FAILED'} to ${appt.patient?.name}`,
    changes: {
      confirmationSentAt: new Date().toISOString(),
      smsSent: smsResult.success,
      smsError: smsResult.success ? null : (smsResult.error ?? 'unknown'),
    },
  })

  if (!smsResult.success) {
    logError(smsResult.error, {
      route: 'appointment-workflow.send-confirmation',
      userId: user.id,
      appointmentId: id,
      patientPhone,
    })
  }

  return c.json({
    success: smsResult.success,
    smsSent: smsResult.success,
    smsError: smsResult.success ? undefined : String(smsResult.error ?? 'SMS provider error'),
    confirmationUrl,
  })
})

// ─── PUBLIC CONFIRM ENDPOINTS ────────────────────────────────────────────────
// No auth. Patients visit via SMS short URL. The token IS the credential, so
// we rate-limit aggressively per IP to deter brute-force guessing and per
// token to deter targeted hammering of a leaked link.
const publicConfirmIpLimiter = createRateLimiter({
  max: 30,
  windowMs: 5 * 60 * 1000,
})
const publicConfirmTokenLimiter = createRateLimiter({
  max: 5,
  windowMs: 10 * 60 * 1000,
})

function checkPublicConfirmLimit(c: Parameters<typeof requireClientIp>[0], token: string) {
  // No trustworthy client address means the request did not come through the
  // proxy that sets it. Refuse rather than bucket it under a shared key.
  const resolved = requireClientIp(c)
  if (!resolved.ok) return { allowed: false as const, retryAfterSec: 60 }
  const ipCheck = publicConfirmIpLimiter.check(`pub-confirm-ip:${resolved.ip}`)
  if (!ipCheck.allowed) return ipCheck
  return publicConfirmTokenLimiter.check(`pub-confirm-tok:${token}`)
}

appointmentWorkflowApp.get('/public/confirm/:token', async (c) => {
  const token = c.req.param('token')
  if (!token) return c.json({ error: 'Invalid token' }, 400)

  const limit = checkPublicConfirmLimit(c, token)
  if (!limit.allowed) {
    return c.json({ error: 'Too many requests', code: 'RATE_LIMITED' }, 429, {
      'Retry-After': String(limit.retryAfterSec),
    })
  }

  const db = getDb(process.env.DATABASE_URL!)
  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.confirmationToken, token),
    columns: { id: true, date: true, status: true, confirmationResponse: true },
  })

  if (!appt) return c.json({ error: 'Link not found or expired' }, 404)

  // Minimal payload. Patient/doctor names removed — knowing the date + that the
  // token is valid is enough for the landing page; identity stays out of any
  // response that's reachable without auth.
  return c.json({
    success: true,
    data: {
      date: appt.date,
      currentResponse: appt.confirmationResponse,
      alreadyActed:
        appt.status === 'cancelled' || appt.status === 'completed' || appt.status === 'no_show',
    },
  })
})

// ─── PUBLIC: POST /api/appointment-workflow/public/confirm/:token ─────────────
// Body: { response: 'yes' | 'no' }
appointmentWorkflowApp.post('/public/confirm/:token', async (c) => {
  const token = c.req.param('token')
  const body = await c.req.json()
  const response = body.response as string

  const limit = checkPublicConfirmLimit(c, token)
  if (!limit.allowed) {
    return c.json({ error: 'Too many requests', code: 'RATE_LIMITED' }, 429, {
      'Retry-After': String(limit.retryAfterSec),
    })
  }

  if (!['yes', 'no'].includes(response)) return c.json({ error: 'Invalid response' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.confirmationToken, token),
  })

  if (!appt) return c.json({ error: 'Link not found or expired' }, 404)

  // Can't act on already-cancelled/completed appointments
  if (appt.status === 'cancelled' || appt.status === 'completed' || appt.status === 'no_show') {
    return c.json({ error: 'This appointment cannot be modified.' }, 400)
  }

  const updates: any = {
    confirmationResponse: response,
    confirmationRespondedAt: new Date(),
    updatedAt: new Date(),
  }
  if (response === 'yes') {
    updates.status = 'confirmed'
  } else if (response === 'no') {
    updates.status = 'cancelled'
  }

  await db.update(appointments).set(updates).where(eq(appointments.id, appt.id))

  // Audit — no user context (patient-initiated via public URL)
  await createAuditLog(db, {
    userId: 'public',
    action: 'update',
    module: 'appointments',
    entityId: appt.id,
    entityName: `Patient ${response === 'yes' ? 'confirmed' : 'cancelled'} via SMS link`,
    changes: { response },
  })

  return c.json({ success: true, response })
})

export { appointmentWorkflowApp }
