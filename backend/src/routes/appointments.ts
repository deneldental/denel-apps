import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { type DB, getDb } from '../db'
import { appointments, patients } from '../db/schema'
import { handleOnBookingReminders } from '../lib/appointment-reminders-service'
import {
  canChangeStatus,
  isCreatableStatus,
  isKnownAppointmentStatus,
  pastDayDecision,
  TERMINAL_APPOINTMENT_STATUSES,
} from '../lib/appointment-status'
import { createAuditLog } from '../lib/audit'
import { checkDoctorAvailable } from '../lib/doctor-availability'
import {
  enrichAppointment,
  syncAppointmentCreated,
  syncAppointmentDeleted,
  syncAppointmentUpdated,
} from '../lib/google-calendar'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { ensurePendingMedicalRecord } from '../lib/pending-medical-record-service'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { sendSMS } from '../lib/sms'
import { resolveSmsTemplate } from '../lib/sms-templates'
import type { HonoEnv } from '../lib/types'
import { isPastAppointmentDate, rejectPastAppointmentDate } from '../lib/validate-date'

const appointmentsApp = new Hono<HonoEnv>()

const MODULE = MODULES.APPOINTMENTS

// ── GET /api/appointments/upcoming-alerts?minutes=N ──────────────────────────
// Returns appointments whose scheduled time falls within the next N minutes.
// Must be declared BEFORE /:id to avoid "upcoming-alerts" being treated as a UUID.
appointmentsApp.get('/upcoming-alerts', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const minutes = Math.max(1, Math.min(120, Number(c.req.query('minutes') ?? 30)))
    const now = new Date()
    const cutoff = new Date(now.getTime() + minutes * 60 * 1000)

    const db = getDb(process.env.DATABASE_URL!)
    const rows = await db.query.appointments.findMany({
      where: and(
        gte(appointments.date, now),
        lte(appointments.date, cutoff),
        eq(appointments.status, 'scheduled')
      ),
      with: {
        patient: true,
        doctor: { with: { user: true, specialist: { with: { user: true } } } },
      },
      limit: 50,
    })

    const data = rows.map((appt: any) => {
      const doc = appt.doctor
      const doctorName =
        doc?.user?.name ?? doc?.specialist?.user?.name ?? doc?.specialist?.name ?? null
      return {
        id: appt.id,
        date: appt.date,
        type: appt.type,
        patientName: appt.patient?.name ?? 'Unknown',
        patientId: appt.patient?.patientId ?? '',
        doctorName,
      }
    })

    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { route: 'appointments.upcoming-alerts', userId: user.id })
    return c.json({ error: 'Failed to fetch upcoming alerts', code: 'UPCOMING_ALERTS_FAILED' }, 500)
  }
})

appointmentsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const patientIdFilter = c.req.query('patientId')
    const doctorIdFilter = c.req.query('doctorId')
    const fromParam = c.req.query('from')
    const toParam = c.req.query('to')
    const limitParam = c.req.query('limit')
    const offsetParam = c.req.query('offset')

    const whereConditions: any[] = []
    if (patientIdFilter) whereConditions.push(eq(appointments.patientId, patientIdFilter))
    if (doctorIdFilter) whereConditions.push(eq(appointments.doctorId, doctorIdFilter))
    if (fromParam) {
      const d = new Date(fromParam)
      if (!Number.isNaN(d.getTime())) whereConditions.push(gte(appointments.date, d))
    }
    if (toParam) {
      const d = new Date(toParam)
      if (!Number.isNaN(d.getTime())) whereConditions.push(lte(appointments.date, d))
    }
    const where = whereConditions.length > 0 ? and(...whereConditions) : undefined

    // Pagination is opt-in to preserve back-compat for callers that fetch all
    // (calendar uses ?from/?to instead; the list view passes ?limit + ?offset).
    const wantsPaging = limitParam !== undefined || offsetParam !== undefined
    const limit = wantsPaging ? Math.min(Math.max(1, Number(limitParam ?? 50)), 500) : undefined
    const offset = wantsPaging ? Math.max(0, Number(offsetParam ?? 0)) : undefined

    const data = await db.query.appointments.findMany({
      where,
      with: {
        patient: true,
        doctor: {
          with: {
            user: true,
            // Specialist-sourced doctors carry their name/email here instead.
            specialist: { with: { user: true } },
          },
        },
      },
      orderBy: [asc(appointments.date)],
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {}),
    })

    const dataWithPrefix = data.map((appointment: any) => {
      // Doctors can be sourced from a staff user OR a specialist. Normalise
      // both into a `doctor.user` shape so the frontend doesn't need to know.
      const doc = appointment.doctor
      if (doc && !doc.user && doc.specialist) {
        const s = doc.specialist
        const synthetic = s.user
          ? {
              id: s.user.id,
              name: s.user.name ?? s.name,
              email: s.user.email ?? s.contactEmail ?? null,
              phone: s.user.phone ?? s.contactPhone ?? null,
            }
          : {
              id: null,
              name: s.name,
              email: s.contactEmail ?? null,
              phone: s.contactPhone ?? null,
            }
        appointment.doctor = { ...doc, user: synthetic }
      }
      if (appointment.doctor?.user) {
        const name = appointment.doctor.user.name || 'Unknown'
        const prefixedName =
          name.startsWith('Dr. ') || name.startsWith('Dr ') ? name : `Dr. ${name}`
        return {
          ...appointment,
          doctor: {
            ...appointment.doctor,
            user: { ...appointment.doctor.user, name: prefixedName },
          },
        }
      }
      return appointment
    })

    if (wantsPaging) {
      const [totalRow] = await db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(appointments)
        .where(where ?? sql`true`)
      return c.json({ success: true, data: dataWithPrefix, total: totalRow?.count ?? 0 })
    }

    return c.json({ success: true, data: dataWithPrefix })
  } catch (error) {
    logError(error, { route: 'appointments.list', userId: user.id })
    return c.json({ error: 'Failed to fetch appointments', code: 'APPTS_LIST_FAILED' }, 500)
  }
})

appointmentsApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const appt = await db.query.appointments.findFirst({
      where: eq(appointments.id, id),
      with: {
        patient: true,
        doctor: { with: { user: true, specialist: { with: { user: true } } } },
      },
    })

    if (!appt) return c.json({ error: 'Not found' }, 404)

    // Normalise doctor source (staff user OR specialist) into doctor.user, then prefix.
    let result: any = appt
    const doc = (appt as any).doctor
    if (doc && !doc.user && doc.specialist) {
      const s = doc.specialist
      const synthetic = s.user
        ? {
            id: s.user.id,
            name: s.user.name ?? s.name,
            email: s.user.email ?? s.contactEmail ?? null,
            phone: s.user.phone ?? s.contactPhone ?? null,
          }
        : {
            id: null,
            name: s.name,
            email: s.contactEmail ?? null,
            phone: s.contactPhone ?? null,
          }
      result = { ...appt, doctor: { ...doc, user: synthetic } }
    }
    if (result.doctor?.user) {
      const name = result.doctor.user.name || 'Unknown'
      const prefixedName = name.startsWith('Dr. ') || name.startsWith('Dr ') ? name : `Dr. ${name}`
      result = {
        ...result,
        doctor: { ...result.doctor, user: { ...result.doctor.user, name: prefixedName } },
      }
    }

    return c.json({ success: true, data: result })
  } catch (error) {
    logError(error, { route: 'appointments.get', userId: user.id, appointmentId: id })
    return c.json({ error: 'Failed to fetch appointment', code: 'APPT_FETCH_FAILED' }, 500)
  }
})

const createAppointmentSchema = z.object({
  data: z.object({
    patientId: z.string().uuid(),
    doctorId: z.string().uuid(),
    // Accept an ISO string (what the clients send) or a Date and coerce to a
    // Date — Drizzle's `appointments.date` timestamp column expects a Date.
    date: z.coerce.date(),
    status: z.string(),
    type: z.string(),
    durationMinutes: z.number().int().positive().optional(),
    notes: z.string().nullish(),
    chairId: z.string().uuid().nullish(),
    clinicId: z.string().uuid().nullish(),
    // Estimate/Activity routing (0168): when true, a checked-in visit enters the
    // doctor's queue (awaiting_estimate) instead of reception-direct billing.
    requiresEstimate: z.boolean().optional(),
  }),
  sendSMS: z.boolean().optional(),
  dateStr: z.string().optional(),
  timeStr: z.string().optional(),
})

appointmentsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const parseResult = createAppointmentSchema.safeParse(await c.req.json())
    if (!parseResult.success)
      return c.json({ error: 'Invalid request body', issues: parseResult.error.issues }, 400)
    const { data: appointmentData, sendSMS: shouldSendSMS, dateStr, timeStr } = parseResult.data
    const db = getDb(process.env.DATABASE_URL!)

    // A visit starts as a booking or a walk-in, never already completed, in the chair or
    // a no-show (and never as arbitrary text): see lib/appointment-status.ts.
    if (!isCreatableStatus(appointmentData.status)) {
      return c.json(
        {
          error: `A new appointment can’t start as "${appointmentData.status}"`,
          code: 'INVALID_STATUS',
        },
        400
      )
    }

    // Hard guard: no booking for dates that have already passed. Same-day
    // past times are allowed (walk-in documentation). Past dates are not.
    // (`date` is already a Date — coerced by the schema above.)
    const guard = rejectPastAppointmentDate(appointmentData.date)
    if (guard) return c.json(guard, 400)

    // Hard guard: a doctor who blocked this window, already has another
    // active appointment then, or whose chair is already occupied then,
    // can't be booked into it. The clients pre-check too, but this is the
    // rule — website-booking conversion, reschedules and API callers all
    // land here.
    const blocked = await checkDoctorAvailable(
      db,
      appointmentData.doctorId,
      appointmentData.date,
      appointmentData.durationMinutes,
      { chairId: appointmentData.chairId }
    )
    if (blocked) return c.json(blocked, 409)

    // Tell middleware to skip automatic logging
    c.set('skipAudit', true)

    // A walk-in booked straight to checked_in: stamp checkedInAt, and route a
    // requires-estimate visit into the doctor's Activity queue (0168).
    const insertValues: typeof appointments.$inferInsert = { ...appointmentData }
    if (appointmentData.status === 'checked_in') {
      insertValues.checkedInAt = new Date()
      if (appointmentData.requiresEstimate) insertValues.estimateStatus = 'awaiting_estimate'
    }

    const [newItem] = await db.insert(appointments).values(insertValues).returning()

    // Specific logging for creation
    const patient = await db.query.patients.findFirst({
      where: eq(patients.id, newItem.patientId),
    })

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'appointments',
      entityId: newItem.id,
      entityName: patient ? `Appointment for ${patient.name}` : 'Appointment',
      changes: newItem,
    })

    // Fire-and-forget Google Calendar sync (no-op if the assigned doctor
    // doesn't have a connected Google account or OAuth isn't configured).
    enrichAppointment(newItem)
      .then((enriched) => syncAppointmentCreated(enriched))
      .catch((err) => logError(err, { context: '[appointments] gcal sync on create failed' }))

    let smsResult: any = { smsSent: false }

    if (shouldSendSMS && newItem.patientId) {
      await handleOnBookingReminders(db, newItem, user.id)
      smsResult = { smsSent: true }
    }

    return c.json({ success: true, data: newItem, ...smsResult })
  } catch (error) {
    logError(error, { route: 'appointments.create', userId: user.id })
    return c.json({ error: 'Failed to create appointment', code: 'APPT_CREATE_FAILED' }, 500)
  }
})

// PATCH body. Mirrors `createAppointmentSchema` but every updatable field is
// optional (a PATCH is a partial update), and it keeps the same
// `{ data, sendSMS, overrideReason }` envelope the clients already send.
// Without this the handler read `body.data` blind and a flat body blew up on
// `updateData.date` — a client mistake reported as a 500 (D4).
const updateAppointmentSchema = z.object({
  data: z.object({
    patientId: z.string().uuid().optional(),
    doctorId: z.string().uuid().optional(),
    // Accept an ISO string (what the clients send) or a Date and coerce to a
    // Date — Drizzle's `appointments.date` timestamp column expects a Date.
    date: z.coerce.date().optional(),
    status: z.string().optional(),
    type: z.string().optional(),
    durationMinutes: z.number().int().positive().optional(),
    notes: z.string().nullish(),
    chairId: z.string().uuid().nullish(),
    clinicId: z.string().uuid().nullish(),
    // Check-in timestamps — the handler also stamps `checkedInAt` itself when a
    // visit flips to checked_in.
    checkedInAt: z.coerce.date().nullish(),
    inChairAt: z.coerce.date().nullish(),
    completedAt: z.coerce.date().nullish(),
    // Estimate/Activity routing (0168).
    requiresEstimate: z.boolean().optional(),
    estimateStatus: z.string().nullish(),
  }),
  sendSMS: z.boolean().optional(),
  overrideReason: z.string().optional(),
})

appointmentsApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  try {
    // `.catch(() => null)` so a body that isn't JSON at all fails the schema
    // (400) instead of throwing into the catch below (500).
    const parseResult = updateAppointmentSchema.safeParse(await c.req.json().catch(() => null))
    if (!parseResult.success)
      return c.json({ error: 'Invalid request body', issues: parseResult.error.issues }, 400)
    const { data: updateData, sendSMS: shouldSendSMS, overrideReason } = parseResult.data
    if (Object.keys(updateData).length === 0)
      return c.json({ error: 'No fields to update', code: 'APPT_UPDATE_EMPTY' }, 400)
    const db = getDb(process.env.DATABASE_URL!)

    // Past-appointment lock: history is immutable for non-admins; admins
    // can edit but must supply a reason which we persist on the audit row.
    const existing = await db.query.appointments.findFirst({
      where: eq(appointments.id, id),
    })
    if (!existing) return c.json({ error: 'Appointment not found' }, 404)

    // Status changes go through the machine in lib/appointment-status.ts (F19).
    // Saving a visit WITHOUT changing its status (the edit form resends the current
    // one) is not a transition and is never refused here.
    const requestedStatus = typeof updateData.status === 'string' ? updateData.status : null
    const statusChange = requestedStatus !== null && requestedStatus !== existing.status

    if (statusChange && !isKnownAppointmentStatus(requestedStatus)) {
      return c.json(
        { error: `Unknown appointment status "${requestedStatus}"`, code: 'INVALID_STATUS' },
        400
      )
    }

    // A terminal appointment (completed/cancelled/no_show) can't be reopened via a
    // status change here — mirrors appointment-workflow.ts's /transition. Non-status
    // edits (e.g. fixing a typo in notes) on a terminal appointment still go through
    // the past-appointment lock below, which already requires an admin + a reason.
    if (statusChange && TERMINAL_APPOINTMENT_STATUSES.has(existing.status)) {
      return c.json(
        {
          error: `This appointment is already ${existing.status.replace('_', ' ')} and can't be changed further.`,
          code: 'APPOINTMENT_TERMINAL',
        },
        409
      )
    }
    if (statusChange && !canChangeStatus(existing.status, requestedStatus)) {
      return c.json(
        {
          error: `A ${existing.status.replace('_', ' ')} appointment can't be moved to ${requestedStatus.replace('_', ' ')}.`,
          code: 'APPOINTMENT_INVALID_TRANSITION',
        },
        409
      )
    }

    // Past-appointment lock (decision D6): history is immutable for non-admins,
    // except that yesterday's visit may be closed out as no-show or completed by a
    // status-only change. Admins can edit anything but must supply a reason, which
    // we persist on the audit row.
    const STATUS_ONLY_KEYS = new Set(['status', 'checkedInAt', 'inChairAt', 'completedAt'])
    const statusOnly =
      statusChange && Object.keys(updateData).every((key) => STATUS_ONLY_KEYS.has(key))
    const pastDecision = pastDayDecision({
      appointmentDate: new Date(existing.date),
      now: new Date(),
      isAdmin: user.roleId === 'admin',
      targetStatus: statusChange ? requestedStatus : null,
      statusOnly,
    })
    if (pastDecision === 'locked') {
      return c.json(
        {
          error: 'Past appointments are read-only',
          code: 'APPOINTMENT_PAST_LOCKED',
        },
        403
      )
    }
    const isPast = pastDecision === 'needs_reason'
    if (isPast && (!overrideReason || String(overrideReason).trim().length < 3)) {
      return c.json(
        {
          error: 'Editing a past appointment requires a reason (3+ chars)',
          code: 'OVERRIDE_REASON_REQUIRED',
        },
        400
      )
    }

    // `date` is already a Date — coerced by the schema above.
    // When date is being changed, the NEW date must not be in the past. The
    // past-appointment-lock above protects the existing-date row; this check
    // protects against rescheduling INTO the past, which is just a creation
    // dressed up as an edit.
    if (updateData.date instanceof Date) {
      const guard = rejectPastAppointmentDate(updateData.date)
      if (guard) return c.json(guard, 400)
    }

    // Conflict guard (block-time, another active appointment for the same
    // doctor, or the same chair), but only when the booking actually MOVES
    // (new time, new doctor, or new chair). A status-only PATCH — check-in,
    // complete, cancel — must keep working on an appointment that a later
    // block/booking happens to overlap; otherwise blocking a day (or booking
    // a neighbouring slot) would freeze the visits already on it.
    // excludeAppointmentId is this row's own id — without it, a reschedule
    // would always "conflict" with itself.
    const movesTime = updateData.date instanceof Date
    const movesDoctor = typeof updateData.doctorId === 'string'
    const movesChair = updateData.chairId !== undefined
    if (movesTime || movesDoctor || movesChair) {
      const nextDate = movesTime ? (updateData.date as Date) : new Date(existing.date)
      const nextDoctorId = movesDoctor ? (updateData.doctorId as string) : existing.doctorId
      const nextChairId = movesChair ? updateData.chairId : existing.chairId
      const nextDuration =
        typeof updateData.durationMinutes === 'number'
          ? updateData.durationMinutes
          : existing.durationMinutes
      const blocked = await checkDoctorAvailable(db, nextDoctorId, nextDate, nextDuration, {
        excludeAppointmentId: id,
        chairId: nextChairId,
      })
      if (blocked) return c.json(blocked, 409)
    }

    // Estimate routing (0168): reception's "Check In" flips status→checked_in; a
    // requires-estimate visit then enters the doctor's Activity queue.
    if (updateData.status === 'checked_in') {
      if (!updateData.checkedInAt && !existing.checkedInAt) updateData.checkedInAt = new Date()
      if (existing.requiresEstimate && !existing.estimateStatus) {
        updateData.estimateStatus = 'awaiting_estimate'
      }
    }

    c.set('skipAudit', true)

    // The status change is conditional on the status we just checked it against,
    // so two overlapping requests cannot both pass the machine; the loser is told
    // the visit changed. A booked patient who is checked in becomes the doctor's
    // next to-do, in the same transaction as the status (F18).
    const becameCheckedIn = statusChange && requestedStatus === 'checked_in'
    const updatedRows = await db.transaction(async (tx) => {
      const rows = await tx
        .update(appointments)
        .set(updateData)
        .where(
          statusChange
            ? and(eq(appointments.id, id), eq(appointments.status, existing.status))
            : eq(appointments.id, id)
        )
        .returning()
      if (rows.length > 0 && becameCheckedIn) {
        await ensurePendingMedicalRecord(tx as unknown as DB, {
          patientId: rows[0].patientId,
          doctorId: rows[0].doctorId,
          appointmentId: id,
        })
      }
      return rows
    })
    const updatedItem = updatedRows[0]
    if (!updatedItem) {
      return c.json(
        {
          error: 'This appointment was just changed by someone else. Refresh and try again.',
          code: 'APPOINTMENT_CHANGED',
        },
        409
      )
    }

    // Fetch context for audit log
    const appointment = await db.query.appointments.findFirst({
      where: eq(appointments.id, id),
      with: { patient: true },
    })

    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'appointments',
      entityId: id,
      entityName: appointment?.patient
        ? `Appointment for ${appointment.patient.name}`
        : 'Appointment',
      changes: updateData,
      reason: isPast ? `[PAST-EDIT] ${String(overrideReason).trim()}` : null,
    })

    // Fire-and-forget Google Calendar sync — patches the existing event in
    // the doctor's calendar, or creates one if they connected after the
    // appointment was originally booked.
    enrichAppointment(updatedItem)
      .then((enriched) => syncAppointmentUpdated(enriched))
      .catch((err) => logError(err, { context: '[appointments] gcal sync on update failed' }))

    let smsResult: any = { smsSent: false }

    if (shouldSendSMS) {
      const appointment = await db.query.appointments.findFirst({
        where: eq(appointments.id, id),
        with: { patient: true },
      })

      if (
        appointment?.patient &&
        (appointment.patient.phone ||
          (appointment.patient.isChild && appointment.patient.guardianPhone))
      ) {
        let smsTemplate: string = await resolveSmsTemplate(
          db,
          'appointment:scheduled',
          process.env.APPOINTMENT_SMS ||
            'Dear {Patientname}, your appointment has been scheduled for {date} at {time}. Please arrive 30 minutes before time'
        )
        if (updateData.status === 'rescheduled')
          smsTemplate = smsTemplate.replace('scheduled', 'rescheduled')

        const appointmentDate = new Date(updatedItem.date || appointment.date)
        const message = smsTemplate
          .replace(/{Patientname}/g, appointment.patient.name || 'Patient')
          .replace(/{date}/g, appointmentDate.toLocaleDateString())
          .replace(/{time}/g, appointmentDate.toLocaleTimeString())

        const contactPhone =
          appointment.patient.isChild && appointment.patient.guardianPhone
            ? appointment.patient.guardianPhone
            : appointment.patient.phone!

        const result = await sendSMS(
          [{ phone: contactPhone, message, patientId: appointment.patient.id }],
          undefined,
          'appointment',
          user.id
        )

        smsResult = {
          smsSent: result.success,
          smsError: result.success ? undefined : result.error,
        }
      }
    }

    return c.json({ success: true, data: updatedItem, ...smsResult })
  } catch (error) {
    logError(error, { route: 'appointments.update', userId: user.id })
    return c.json({ error: 'Failed to update appointment', code: 'APPT_UPDATE_FAILED' }, 500)
  }
})

appointmentsApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  try {
    const db = getDb(process.env.DATABASE_URL!)
    c.set('skipAudit', true)

    const appointment = await db.query.appointments.findFirst({
      where: eq(appointments.id, id),
      with: { patient: true },
    })

    // A missing row previously fell through to a no-op delete that still
    // answered 200 and wrote an audit entry for an appointment that never
    // existed. Report the miss instead.
    if (!appointment) {
      return c.json({ error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' }, 404)
    }

    // Past-appointment lock — same rules as the PATCH handler. DELETE accepts
    // the override reason via the `?reason=` query string (the action wrapper
    // uses GET-style cancellation with no body).
    if (appointment) {
      const isPast = isPastAppointmentDate(new Date(appointment.date))
      const overrideReason = (c.req.query('reason') ?? '').trim()
      if (isPast) {
        if (user.roleId !== 'admin') {
          return c.json(
            { error: 'Past appointments are read-only', code: 'APPOINTMENT_PAST_LOCKED' },
            403
          )
        }
        if (overrideReason.length < 3) {
          return c.json(
            {
              error: 'Deleting a past appointment requires a reason (3+ chars)',
              code: 'OVERRIDE_REASON_REQUIRED',
            },
            400
          )
        }
      }
    }

    // Snapshot Google Calendar event links BEFORE the cascade wipes them.
    // The actual Google API deletions then run fire-and-forget.
    await syncAppointmentDeleted(id)

    await db.delete(appointments).where(eq(appointments.id, id))

    const overrideReason = (c.req.query('reason') ?? '').trim()
    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: 'appointments',
      entityId: id,
      entityName: appointment?.patient
        ? `Appointment for ${appointment.patient.name}`
        : 'Appointment',
      reason: overrideReason ? `[PAST-EDIT] ${overrideReason}` : null,
    })

    return c.json({ success: true })
  } catch (error) {
    logError(error, { route: 'appointments.delete', userId: user.id, appointmentId: id })
    return c.json({ error: 'Failed to delete appointment', code: 'APPT_DELETE_FAILED' }, 500)
  }
})

export { appointmentsApp }
