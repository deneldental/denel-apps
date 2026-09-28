import { asc, desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { appointments, appointmentTypes, patients, websiteBookings } from '../db/schema'
import { requireApiKey } from '../lib/api-keys'
import { createAuditLog } from '../lib/audit'
import { checkDoctorAvailable } from '../lib/doctor-availability'
import { enrichAppointment, syncAppointmentCreated } from '../lib/google-calendar'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { createRateLimiter, requireClientIp } from '../lib/rate-limiter'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { rejectPastAppointmentDate } from '../lib/validate-date'

const websiteBookingsApp = new Hono<HonoEnv>()

// Public-submission rate limit: 5 bookings per IP per 10 minutes. Legit
// website users submit at most one; this catches floods + retries gone wrong.
const publicSubmissionLimiter = createRateLimiter({
  max: 5,
  windowMs: 10 * 60 * 1000,
})

// Free-text caps to keep DB rows small and prevent storage abuse.
const MAX_NAME = 100
const MAX_EMAIL = 254
const MAX_PHONE = 32
const MAX_SERVICE = 120
const MAX_MESSAGE = 2000

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[+\d\s()-]{7,32}$/

function clamp(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null
  const trimmed = s.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, max)
}

const MODULE = MODULES.APPOINTMENTS

// ── State machine for booking status ────────────────────────────────────────
// Valid transitions out of each status. Terminal statuses have an empty set.
const ALLOWED_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  new: new Set(['contacted', 'booked', 'cancelled']),
  contacted: new Set(['booked', 'cancelled']),
  booked: new Set(['cancelled']),
  cancelled: new Set(),
}

function isValidTransition(current: string, next: string): boolean {
  if (current === next) return true
  const allowed = ALLOWED_TRANSITIONS[current]
  if (!allowed) return false
  return allowed.has(next)
}

// GET /api/website-bookings — list all
websiteBookingsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const data = await db.select().from(websiteBookings).orderBy(desc(websiteBookings.createdAt))

  return c.json({ success: true, data })
})

// GET /api/website-bookings/appointment-types — active appointment types for
// the public website's service picker. Same API key as the booking POST, so
// the website submits a canonical type that converts to a consistent appointment.
websiteBookingsApp.get(
  '/appointment-types',
  requireApiKey('website_bookings.create'),
  async (c) => {
    const db = getDb(process.env.DATABASE_URL!)
    const data = await db
      .select({
        id: appointmentTypes.id,
        name: appointmentTypes.name,
        displayName: appointmentTypes.displayName,
      })
      .from(appointmentTypes)
      .where(eq(appointmentTypes.isActive, true))
      .orderBy(asc(appointmentTypes.name))
    return c.json({ success: true, data })
  }
)

// POST /api/website-bookings — called by the marketing website. Requires an
// API key with the `website_bookings.create` scope (issued via Integrations
// settings). Rate-limited by IP as defence-in-depth against a leaked key.
websiteBookingsApp.post('/', requireApiKey('website_bookings.create'), async (c) => {
  const resolved = requireClientIp(c)
  if (!resolved.ok) {
    return c.json({ error: 'Client address unavailable', code: 'UNTRUSTED_ORIGIN' }, 400)
  }
  const limit = publicSubmissionLimiter.check(`website-bookings:${resolved.ip}`)
  if (!limit.allowed) {
    return c.json(
      { error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(limit.retryAfterSec) }
    )
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  const name = clamp(body.name, MAX_NAME)
  const phone = clamp(body.phone, MAX_PHONE)
  const emailRaw = clamp(body.email, MAX_EMAIL)
  const service = clamp(body.service, MAX_SERVICE)
  const message = clamp(body.message, MAX_MESSAGE)
  const preferredDate = clamp(body.preferredDate, 10) // YYYY-MM-DD
  const preferredTime = clamp(body.preferredTime, 5) // HH:MM

  if (!name) return c.json({ error: 'name is required', code: 'INVALID_NAME' }, 400)
  if (!phone || !PHONE_RE.test(phone))
    return c.json({ error: 'valid phone is required', code: 'INVALID_PHONE' }, 400)
  if (emailRaw && !EMAIL_RE.test(emailRaw))
    return c.json({ error: 'invalid email', code: 'INVALID_EMAIL' }, 400)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const [booking] = await db
      .insert(websiteBookings)
      .values({
        name,
        email: emailRaw,
        phone,
        preferredDate,
        preferredTime,
        service,
        message,
        status: 'new',
      })
      .returning()
    return c.json({ success: true, data: booking })
  } catch (error) {
    logError(error, { route: 'website-bookings.create', ip: resolved.ip })
    return c.json({ error: 'Failed to create booking', code: 'BOOKING_CREATE_FAILED' }, 500)
  }
})

// PATCH /api/website-bookings/:id — update status / staff notes
websiteBookingsApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const body = (await c.req.json()) as {
    status?: 'new' | 'contacted' | 'booked' | 'cancelled'
    staffNotes?: string | null
    cancellationReason?: string | null
  }

  const existing = await db.query.websiteBookings.findFirst({
    where: eq(websiteBookings.id, id),
  })
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // Enforce state machine if the caller is attempting to change status.
  if (typeof body.status === 'string' && body.status !== existing.status) {
    if (!isValidTransition(existing.status, body.status)) {
      return c.json(
        {
          error: `Invalid status transition: ${existing.status} → ${body.status}`,
        },
        400
      )
    }
  }

  // Cancelling a patient-app request requires a reason the patient will see.
  const cancelReason = clamp(body.cancellationReason, MAX_MESSAGE)
  if (body.status === 'cancelled' && existing.source === 'patient_pwa' && !cancelReason) {
    return c.json({ error: 'A cancellation reason is required for patient-app requests.' }, 400)
  }

  const updatePayload: Record<string, unknown> = { updatedAt: new Date() }
  if (typeof body.status === 'string') updatePayload.status = body.status
  if ('staffNotes' in body) updatePayload.staffNotes = body.staffNotes ?? null
  if (body.status === 'cancelled') updatePayload.cancellationReason = cancelReason

  c.set('skipAudit', true)

  const [updated] = await db
    .update(websiteBookings)
    .set(updatePayload)
    .where(eq(websiteBookings.id, id))
    .returning()

  if (!updated) return c.json({ error: 'Not found' }, 404)

  await createAuditLog(db, {
    userId: user.id,
    action: 'update',
    module: 'website_bookings',
    entityId: id,
    entityName: `Booking — ${existing.name}`,
    changes: {
      before: { status: existing.status, staffNotes: existing.staffNotes },
      after: { status: updated.status, staffNotes: updated.staffNotes },
    },
  })

  return c.json({ success: true, data: updated })
})

// POST /api/website-bookings/:id/convert-to-appointment
// Body: { patientId: string; doctorId: string; date?: string; time?: string; type?: string; durationMinutes?: number; notes?: string }
// Creates an appointment, links it back to the booking, flips booking.status='booked'.
websiteBookingsApp.post('/:id/convert-to-appointment', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  const body = (await c.req.json().catch(() => ({}))) as {
    /** When set, link to an existing patient. When omitted, the endpoint
     *  auto-creates an ad-hoc patient from the booking's name + phone (or
     *  the optional `patient` override) — appropriate for web bookings where
     *  the caller isn't an existing patient yet. */
    patientId?: string
    /** Inline new-patient override. Lets the receptionist correct the name
     *  or phone the website submitted before the patient record is created. */
    patient?: {
      name?: string
      phone?: string
      email?: string | null
    }
    doctorId?: string
    date?: string
    time?: string
    type?: string
    durationMinutes?: number
    notes?: string
  }

  const booking = await db.query.websiteBookings.findFirst({
    where: eq(websiteBookings.id, id),
  })
  if (!booking) return c.json({ error: 'Booking not found' }, 404)

  // Idempotency guard: if the booking already has a linked appointment, 409.
  if (booking.appointmentId) {
    return c.json(
      {
        error: 'Booking already converted to an appointment',
        appointmentId: booking.appointmentId,
      },
      409
    )
  }

  // Cannot convert a cancelled booking.
  if (booking.status === 'cancelled') {
    return c.json({ error: 'Cannot convert a cancelled booking' }, 400)
  }

  if (!body.doctorId) return c.json({ error: 'doctorId is required' }, 400)

  // Resolve the appointment date. Prefer body overrides; fall back to booking preferences.
  const dateStr = body.date ?? booking.preferredDate
  const timeStr = body.time ?? booking.preferredTime
  if (!dateStr) return c.json({ error: 'date is required (no preferredDate on booking)' }, 400)

  // Strict format validation. Without it, malformed input produces a NaN Date
  // that downstream layers (drizzle, calendar render) treat as 1970-01-01.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
  const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/
  if (!DATE_RE.test(dateStr)) {
    return c.json({ error: 'Invalid date format (expected YYYY-MM-DD)', code: 'INVALID_DATE' }, 400)
  }
  if (timeStr && !TIME_RE.test(timeStr)) {
    return c.json({ error: 'Invalid time format (expected HH:MM)', code: 'INVALID_TIME' }, 400)
  }

  const composite = timeStr ? `${dateStr}T${timeStr.slice(0, 5)}` : `${dateStr}T09:00`
  const apptDate = new Date(composite)
  if (Number.isNaN(apptDate.getTime())) {
    return c.json({ error: 'Invalid date/time', code: 'INVALID_DATE_TIME' }, 400)
  }

  // Same past-date guard applied to direct appointment creates — converting
  // a booking is just a creation with a few extra steps.
  const pastGuard = rejectPastAppointmentDate(apptDate)
  if (pastGuard) return c.json(pastGuard, 400)

  // …and the same block-time guard: a blocked doctor can't be booked, whether
  // the booking came from the calendar or the public website form.
  const blocked = await checkDoctorAvailable(
    db,
    body.doctorId,
    apptDate,
    body.durationMinutes ?? 30
  )
  if (blocked) return c.json(blocked, 409)

  c.set('skipAudit', true)

  // Resolve / create the patient. The web-booking flow defaults to auto-
  // create — the public submitter is by definition not yet an existing
  // patient record. An explicit `patientId` opts back into the existing-
  // patient path (kept for the receptionist who recognises the name and
  // wants to attach to a known record instead).
  //
  // We deliberately only carry NAME + PHONE onto the new patient record.
  // The booking's email is kept on the booking row but not auto-promoted —
  // patient email is something the receptionist enters explicitly during
  // the proper patient-profile completion after check-in.
  // A patient-app request already belongs to a real patient (booking.patientId),
  // so link that existing record — never auto-create a duplicate. Web bookings
  // (no patientId) fall back to ad-hoc creation from name + phone.
  const linkedPatientId = body.patientId ?? booking.patientId ?? undefined
  const adhocName = body.patient?.name?.trim() || booking.name.trim()
  const adhocPhone = body.patient?.phone?.trim() || booking.phone.trim()
  if (!linkedPatientId && !adhocName) {
    return c.json({ error: 'Patient name is required' }, 400)
  }

  const { appt: newAppt, updatedBooking } = await db.transaction(async (tx) => {
    let resolvedPatientId = linkedPatientId

    if (!resolvedPatientId) {
      // Idempotent sequence-setup mirrors the patient-create route — re-runs
      // are no-ops, fresh dev DBs get the sequence on first insert.
      await tx.execute(sql`
        DO $$
        DECLARE max_id BIGINT; cur_val BIGINT;
        BEGIN
          CREATE SEQUENCE IF NOT EXISTS patient_id_seq START 1;

          -- Strip ALL non-digits (mirrors the patient-create route). A plain
          -- REPLACE('#FDM','') throws on non-standard ids like '#FDM-E2E-1';
          -- REGEXP_REPLACE + NULLIF tolerates them (and any id with no digits).
          SELECT COALESCE(MAX(CAST(NULLIF(REGEXP_REPLACE("patientId", '[^0-9]', '', 'g'), '') AS BIGINT)), 0)
            INTO max_id FROM patients WHERE "patientId" LIKE '#FDM%';
          SELECT last_value INTO cur_val FROM patient_id_seq;
          IF max_id >= cur_val THEN
            PERFORM setval('patient_id_seq', max_id + 1, false);
          END IF;
        END $$
      `)
      const seqResult = await tx.execute<{ nextval: string }>(sql`SELECT nextval('patient_id_seq')`)
      const nextval = (seqResult.rows[0] as { nextval: string }).nextval
      const formattedId = `#FDM${String(nextval).padStart(6, '0')}`

      // Sentinel dob/gender — the receptionist edits the patient record after
      // the appointment is checked-in. Marking `category='one_time'` flags
      // this as a walk-in / external-source patient for downstream reports.
      const [adhoc] = await tx
        .insert(patients)
        .values({
          name: adhocName,
          phone: adhocPhone || null,
          dob: new Date('1900-01-01T00:00:00Z'),
          gender: 'other',
          category: 'one_time',
          patientId: formattedId,
        })
        .returning()
      resolvedPatientId = adhoc.id
    }

    const [appt] = await tx
      .insert(appointments)
      .values({
        patientId: resolvedPatientId,
        doctorId: body.doctorId!,
        date: apptDate,
        durationMinutes: body.durationMinutes ?? 30,
        status: 'scheduled',
        type: body.type ?? booking.service ?? 'consultation',
        notes: body.notes ?? booking.message ?? null,
      })
      .returning()

    const [bookingRow] = await tx
      .update(websiteBookings)
      .set({
        status: 'booked',
        appointmentId: appt.id,
        updatedAt: new Date(),
      })
      .where(eq(websiteBookings.id, id))
      .returning()

    return { appt, updatedBooking: bookingRow }
  })

  await createAuditLog(db, {
    userId: user.id,
    action: 'create',
    module: 'appointments',
    entityId: newAppt.id,
    entityName: `Appointment from website booking — ${booking.name}`,
    changes: { fromBookingId: id, appointment: newAppt },
  })

  await createAuditLog(db, {
    userId: user.id,
    action: 'update',
    module: 'website_bookings',
    entityId: id,
    entityName: `Booking — ${booking.name}`,
    changes: {
      before: { status: booking.status, appointmentId: null },
      after: { status: 'booked', appointmentId: newAppt.id },
    },
  })

  // Fire-and-forget Google Calendar sync — mirrors what the normal
  // appointment-create route does. Without this, appointments converted
  // from a website booking never surface on the doctor's GCal even though
  // they show up on the in-app calendar.
  enrichAppointment(newAppt)
    .then((enriched) => syncAppointmentCreated(enriched))
    .catch((err) => logError(err, { context: '[website-bookings] gcal sync on create failed' }))

  return c.json({ success: true, data: { booking: updatedBooking, appointment: newAppt } })
})

export { websiteBookingsApp }
