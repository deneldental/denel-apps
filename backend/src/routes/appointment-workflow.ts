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
import { z } from 'zod'
import { type DB, getDb } from '../db'
import { appointments, patients } from '../db/schema'
import { CheckInError, checkInAppointment } from '../lib/appointment-checkin'
import {
  canChangeStatus,
  isPreArrivalStatus,
  pastDayDecision,
  TERMINAL_APPOINTMENT_STATUSES,
} from '../lib/appointment-status'
import { createAuditLog } from '../lib/audit'
import { enrichAppointment, syncAppointmentUpdated } from '../lib/google-calendar'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { sendPaymentReceiptSms } from '../lib/payment-receipt-sms'
import { ensurePendingMedicalRecord } from '../lib/pending-medical-record-service'
import { portalLink } from '../lib/public-urls'
import { createRateLimiter, requireClientIp } from '../lib/rate-limiter'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { sendSMS } from '../lib/sms'
import { REDACTED_TOKEN_MARKER } from '../lib/sms-redaction'
import { renderSms, resolveSmsTemplate } from '../lib/sms-templates'
import type { HonoEnv } from '../lib/types'
import { isPastAppointmentDate } from '../lib/validate-date'

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
  const now = new Date()
  const overrideReason = typeof body.overrideReason === 'string' ? body.overrideReason.trim() : ''

  // The check, the write and (on check-in) the doctor's note are one transaction
  // on a locked row. A second request for the same visit waits for the first and
  // then sees the result, so the status machine cannot be raced past (F19).
  type Outcome =
    | {
        ok: true
        updated: typeof appointments.$inferSelect
        updates: Record<string, unknown>
        pastReason: string | null
      }
    | { ok: false; status: 400 | 403 | 404 | 409; body: { error: string; code: string } }

  let outcome: Outcome
  try {
    outcome = await db.transaction(async (rawTx): Promise<Outcome> => {
      const [current] = await rawTx
        .select()
        .from(appointments)
        .where(eq(appointments.id, id))
        .for('update')
      if (!current) {
        return {
          ok: false,
          status: 404,
          body: { error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' },
        }
      }
      if (TERMINAL_APPOINTMENT_STATUSES.has(current.status)) {
        return {
          ok: false,
          status: 409,
          body: {
            error: `This appointment is already ${current.status.replace('_', ' ')} and can't be changed further.`,
            code: 'APPOINTMENT_TERMINAL',
          },
        }
      }
      if (!canChangeStatus(current.status, transition.status)) {
        return {
          ok: false,
          status: 409,
          body: {
            error: `A ${current.status.replace('_', ' ')} appointment can't be moved to ${transition.status.replace('_', ' ')}.`,
            code: 'APPOINTMENT_INVALID_TRANSITION',
          },
        }
      }

      // A visit from a previous day: admin with a reason, or yesterday's close-out (D6).
      const decision = pastDayDecision({
        appointmentDate: new Date(current.date),
        now,
        isAdmin: user.roleId === 'admin',
        targetStatus: transition.status,
        statusOnly: true,
      })
      if (decision === 'locked') {
        return {
          ok: false,
          status: 403,
          body: { error: 'Past appointments are read-only', code: 'APPOINTMENT_PAST_LOCKED' },
        }
      }
      if (decision === 'needs_reason' && overrideReason.length < 3) {
        return {
          ok: false,
          status: 400,
          body: {
            error: 'Changing a past appointment requires a reason (3+ chars)',
            code: 'OVERRIDE_REASON_REQUIRED',
          },
        }
      }

      const updates: Record<string, unknown> = { status: transition.status, updatedAt: now }
      if (transition.timestampField) updates[transition.timestampField] = now

      // Estimate routing (0168): a requires-estimate visit enters the doctor's
      // Activity queue on check-in (awaiting_estimate) rather than reception-direct.
      if (
        transition.status === 'checked_in' &&
        current.requiresEstimate &&
        !current.estimateStatus
      ) {
        updates.estimateStatus = 'awaiting_estimate'
      }

      // Append a timestamped note when provided (e.g. no-show "last response from patient")
      if (incomingNote) {
        const stamp = `[${transition.status} ${now.toISOString()}]: ${incomingNote}`
        updates.notes = current.notes ? `${current.notes}\n${stamp}` : stamp
      }

      const [updated] = await rawTx
        .update(appointments)
        .set(updates)
        .where(eq(appointments.id, id))
        .returning()

      // A booked patient who arrives is the doctor's next to-do (F18).
      if (transition.status === 'checked_in') {
        await ensurePendingMedicalRecord(rawTx as unknown as DB, {
          patientId: current.patientId,
          doctorId: current.doctorId,
          appointmentId: current.id,
        })
      }

      return {
        ok: true,
        updated,
        updates,
        pastReason: decision === 'needs_reason' ? overrideReason : null,
      }
    })
  } catch (error) {
    logError(error, { route: 'appointment-workflow.transition' })
    return c.json({ error: 'Failed to transition', code: 'WORKFLOW_TRANSITION_FAILED' }, 500)
  }

  if (!outcome.ok) return c.json(outcome.body, outcome.status)
  const { updated, updates, pastReason } = outcome

  await createAuditLog(db, {
    userId: user.id,
    action: 'update',
    module: 'appointments',
    entityId: id,
    entityName: `Appointment transition → ${transition.status}`,
    changes: updates,
    reason: pastReason ? `[PAST-EDIT] ${pastReason}` : null,
  })

  // Sync status change to Google Calendar — sync helper deletes the event
  // if the new status is cancelled / no_show, patches it otherwise.
  enrichAppointment(updated)
    .then((enriched) => syncAppointmentUpdated(enriched))
    .catch((err) => logError(err, { route: 'appointment-workflow.transition.sync' }))

  return c.json({ success: true, data: updated })
})

// ─── POST /api/appointment-workflow/:id/check-in ─────────────────────────────
// Check a patient in: the payment (if any), the status change and the doctor's
// note in ONE transaction. See lib/appointment-checkin.ts.
// Body: exactly one of
//   { payment: { amount, method, description?, treatments?, sendNotification? } }
//   { noPaymentReason: string }
//   { paymentRecordedElsewhere: true }   — plan or insurance, already linked to this visit
// plus { overrideReason } when an admin changes a visit from a previous day.
const checkInSchema = z
  .object({
    payment: z
      .object({
        amount: z.number().positive(),
        method: z.string().trim().min(1),
        description: z.string().nullish(),
        treatments: z.array(z.unknown()).optional(),
        sendNotification: z.boolean().optional(),
        transactionId: z.string().nullish(),
        externalReference: z.string().nullish(),
        paymentDate: z.coerce.date().optional(),
      })
      .optional(),
    noPaymentReason: z.string().trim().min(3).optional(),
    paymentRecordedElsewhere: z.literal(true).optional(),
    overrideReason: z.string().optional(),
  })
  .refine(
    (v) =>
      [v.payment, v.noPaymentReason, v.paymentRecordedElsewhere].filter((m) => m !== undefined)
        .length === 1,
    { message: 'Give exactly one of payment, noPaymentReason or paymentRecordedElsewhere' }
  )

appointmentWorkflowApp.post('/:id/check-in', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.APPOINTMENTS as string, ACTIONS.UPDATE as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const parsed = checkInSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid check-in request',
        code: 'CHECKIN_PAYMENT_MODE_REQUIRED',
        issues: parsed.error.issues,
      },
      400
    )
  }
  const body = parsed.data

  // Taking money is a payments action, not an appointments one.
  if (
    body.payment &&
    !(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.CREATE as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  let result: Awaited<ReturnType<typeof checkInAppointment>>
  try {
    result = await checkInAppointment(db, {
      appointmentId: id,
      user: { id: user.id, roleId: user.roleId },
      payment: body.payment,
      noPaymentReason: body.noPaymentReason,
      paymentRecordedElsewhere: body.paymentRecordedElsewhere,
      overrideReason: body.overrideReason,
    })
  } catch (error) {
    if (error instanceof CheckInError) return c.json(error.body, error.httpStatus)
    logError(error, { route: 'appointment-workflow.check-in', appointmentId: id })
    return c.json({ error: 'Failed to check in', code: 'CHECKIN_FAILED' }, 500)
  }

  // Everything below happens AFTER the commit and may not undo it.
  let smsError: string | undefined
  if (!result.alreadyCheckedIn) {
    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'appointments',
      entityId: id,
      entityName: 'Appointment check-in',
      changes: {
        status: 'checked_in',
        paymentId: result.payment?.id ?? null,
        mode: body.payment ? 'payment' : body.noPaymentReason ? 'no_payment' : 'recorded_elsewhere',
        noPaymentReason: body.noPaymentReason ?? null,
      },
      reason: result.pastDayReason ? `[PAST-EDIT] ${result.pastDayReason}` : null,
    })

    enrichAppointment(result.appointment)
      .then((enriched) => syncAppointmentUpdated(enriched))
      .catch((err) => logError(err, { route: 'appointment-workflow.check-in.sync' }))

    if (result.payment && body.payment?.sendNotification) {
      const [patient] = await db
        .select()
        .from(patients)
        .where(eq(patients.id, result.appointment.patientId))
        .limit(1)
      if (patient) {
        const sms = await sendPaymentReceiptSms(db, {
          patient,
          amount: body.payment.amount,
          balance: null,
          description: body.payment.description,
          userId: user.id,
        })
        smsError = sms.error
      }
    }
  }

  return c.json({
    success: true,
    data: {
      appointment: result.appointment,
      payment: result.payment,
      alreadyCheckedIn: result.alreadyCheckedIn,
    },
    ...(smsError ? { smsError } : {}),
  })
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
  // /c/:token is a page of the clinic portal (not of the patient app).
  const confirmationUrl = portalLink(`/c/${token}`)

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
  const templateVars = {
    name: appt.patient?.name || 'Patient',
    ClinicName: process.env.CLINIC_NAME || 'Denel',
    date: apptDate.toLocaleDateString(),
    time: apptDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    doctor: doctorName,
  }
  const message = renderSms(template, { ...templateVars, url: confirmationUrl })
  // The token in the link is a bearer credential (anyone holding it can confirm
  // or cancel this appointment), so the SMS log keeps the message without it.
  // Same treatment as `confirmationToken` in lib/audit.ts.
  const storedMessage = renderSms(template, {
    ...templateVars,
    url: portalLink(`/c/${REDACTED_TOKEN_MARKER}`),
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
    [{ phone: patientPhone, message, storedMessage, patientId: appt.patient?.id }],
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
      // The link can no longer act once the visit is over, the patient has
      // arrived, or the day has passed.
      alreadyActed: !isPreArrivalStatus(appt.status) || isPastAppointmentDate(new Date(appt.date)),
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
  if (TERMINAL_APPOINTMENT_STATUSES.has(appt.status)) {
    return c.json({ error: 'This appointment cannot be modified.' }, 400)
  }

  // The link is a token anyone holding the SMS can use, so it may only do what
  // the machine allows a patient to do: confirm or cancel a visit that has not
  // started. An old link must not pull a patient who is already here back to
  // "confirmed" (re-opening check-in and a second payment) or cancel their visit
  // while it is under way (F19).
  if (isPastAppointmentDate(new Date(appt.date))) {
    return c.json({ error: 'This appointment has passed.', code: 'APPOINTMENT_PASSED' }, 400)
  }
  if (!isPreArrivalStatus(appt.status)) {
    if (response === 'no') {
      return c.json(
        {
          error: "You've already arrived. Please speak to reception to make changes.",
          code: 'APPOINTMENT_ALREADY_ARRIVED',
        },
        400
      )
    }
    // "Yes, I'm coming" from someone already here: nothing to change.
    return c.json({ success: true, response })
  }

  const updates: any = {
    confirmationResponse: response,
    confirmationRespondedAt: new Date(),
    updatedAt: new Date(),
  }
  if (response === 'yes') {
    // Already confirmed is not a move; only record the answer.
    if (appt.status !== 'confirmed') updates.status = 'confirmed'
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
