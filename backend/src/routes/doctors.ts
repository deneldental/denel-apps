import { eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { doctors, doctorUnavailability, specialists } from '../db/schema'
import { doctorRowSpecialty, specialtyLabels } from '../lib/doctor-specialty'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const doctorsApp = new Hono<HonoEnv>()

const _USERS_MODULE = MODULES.USERS
const APPOINTMENTS_MODULE = MODULES.APPOINTMENTS

// GET /api/doctors - Fetch all doctors. Sourced exclusively from the
// `specialists` table (post-unification migration 0048). Auto-provisions a
// `doctors` row for every active specialist that doesn't have one yet so the
// appointment dropdown is always complete.
//
// Response shape: each row carries a `source: 'specialist'` discriminator and
// a `user` object. For internal specialists `user` reflects the linked user
// row (real id, login-capable). For external specialists `user` is synthetic
// (id=null) so existing dropdowns that read `doctor.user.name` keep working.
doctorsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, APPOINTMENTS_MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const [allSpecialists, existingDoctors] = await Promise.all([
      db.query.specialists.findMany({
        where: eq(specialists.isActive, true),
        with: { user: true },
      }),
      db.query.doctors.findMany({ with: { user: true } }),
    ])

    const bySpecialistId = new Map<string, (typeof existingDoctors)[number]>()
    for (const d of existingDoctors) {
      if (d.specialistId) bySpecialistId.set(d.specialistId, d)
    }

    // Batch-provision any doctors rows still missing (was an N+1 loop).
    const missing = allSpecialists.filter((s) => !bySpecialistId.has(s.id))
    if (missing.length > 0) {
      // This is a GET that writes, and the first people to open the calendar after a
      // specialist is added all reach it together: each saw the row missing, each inserted
      // it, and every request but the winner hit the unique index on specialistId and
      // answered 500 (F46). ON CONFLICT DO NOTHING makes the provisioning idempotent, and
      // the rows are read back rather than taken from RETURNING, which omits the ones
      // another request created first.
      // The row shows the specialist's own specialty, not a placeholder (D17 / F47).
      const labels = await specialtyLabels(
        db,
        missing.map((s) => s.specialty)
      )
      await db
        .insert(doctors)
        .values(
          missing.map((s) => ({
            specialistId: s.id,
            specialty: doctorRowSpecialty(s, labels),
            contactNumber: s.contactPhone ?? null,
          }))
        )
        .onConflictDoNothing()
      const provisioned = await db.query.doctors.findMany({
        where: inArray(
          doctors.specialistId,
          missing.map((s) => s.id)
        ),
        with: { user: true },
      })
      for (const d of provisioned) {
        if (d.specialistId) bySpecialistId.set(d.specialistId, d)
      }
    }

    type Row = Record<string, any>
    const rows: Row[] = []
    for (const s of allSpecialists) {
      const d = bySpecialistId.get(s.id)
      if (!d) continue
      const name = s.name || 'Unknown Doctor'
      const prefixedName = name.startsWith('Dr. ') || name.startsWith('Dr ') ? name : `Dr. ${name}`
      // Prefer the linked user's contact info when present (always fresh,
      // edited via HR > Doctors). Fall back to the specialist's own fields.
      const userObj = s.user
        ? {
            id: s.user.id,
            name: prefixedName,
            email: s.user.email ?? s.contactEmail ?? null,
            phone: s.user.phone ?? s.contactPhone ?? null,
            image: s.user.image ?? null,
          }
        : {
            id: null,
            name: prefixedName,
            email: s.contactEmail ?? null,
            phone: s.contactPhone ?? null,
            image: null,
          }
      rows.push({
        ...d,
        source: 'specialist',
        specialistType: s.specialistType,
        user: userObj,
      })
    }

    return c.json({ success: true, data: rows })
  } catch (error) {
    logError(error, { route: 'doctors.list', userId: user.id })
    return c.json({ error: 'Failed to fetch doctors', code: 'DOCTORS_LIST_FAILED' }, 500)
  }
})

// GET /api/doctors/me — the calling user's own doctor profile, or null.
//
// Callers cannot resolve "which doctor am I?" from GET /api/doctors: that list is
// built by walking `specialists`, so a `doctors` row linked straight to a user
// (userId set, specialistId null — how the seed and the legacy path provision
// them) never appears in it. Both linkage shapes are checked here:
//   1. doctors.userId = me          — direct link
//   2. doctors.specialistId → specialists.userId = me — specialist-sourced link
doctorsApp.get('/me', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const direct = await db.query.doctors.findFirst({
      where: eq(doctors.userId, user.id),
      with: { user: true },
    })

    if (direct) {
      return c.json({
        success: true,
        data: { id: direct.id, specialty: direct.specialty, name: direct.user?.name ?? null },
      })
    }

    const specialist = await db.query.specialists.findFirst({
      where: eq(specialists.userId, user.id),
    })

    if (specialist) {
      const viaSpecialist = await db.query.doctors.findFirst({
        where: eq(doctors.specialistId, specialist.id),
      })
      if (viaSpecialist) {
        const name = specialist.name ?? null
        return c.json({
          success: true,
          data: {
            id: viaSpecialist.id,
            specialty: viaSpecialist.specialty,
            name: name && !/^Dr\.? /.test(name) ? `Dr. ${name}` : name,
          },
        })
      }
    }

    // Not a doctor, or an unlinked account — the caller decides how to surface it.
    return c.json({ success: true, data: null })
  } catch (error) {
    logError(error, { route: 'doctors.me', userId: user.id })
    return c.json({ error: 'Failed to resolve doctor profile', code: 'DOCTOR_ME_FAILED' }, 500)
  }
})

// GET /api/doctors/unavailability - Fetch all unavailability records
doctorsApp.get('/unavailability', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, APPOINTMENTS_MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const doctorId = c.req.query('doctorId')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const whereClause = doctorId ? eq(doctorUnavailability.doctorId, doctorId) : undefined
    const data = await db.query.doctorUnavailability.findMany({
      where: whereClause,
      with: { doctor: { with: { user: true } } },
    })
    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { route: 'doctors.unavailability.list', userId: user.id })
    return c.json({ error: 'Failed to fetch unavailability' }, 500)
  }
})

const createUnavailabilitySchema = z
  .object({
    doctorId: z.string().uuid(),
    // Accept an ISO string (what the clients send) or a Date and coerce to a
    // Date — Drizzle's timestamp columns expect a Date and call .toISOString()
    // on whatever they're given.
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
    reason: z.string().max(200).nullish(),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  })

// POST /api/doctors/unavailability - Create unavailability record
doctorsApp.post('/unavailability', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, APPOINTMENTS_MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const parseResult = createUnavailabilitySchema.safeParse(await c.req.json())
    if (!parseResult.success)
      return c.json({ error: 'Invalid request body', issues: parseResult.error.issues }, 400)

    const db = getDb(process.env.DATABASE_URL!)
    const [newItem] = await db.insert(doctorUnavailability).values(parseResult.data).returning()
    return c.json({ success: true, data: newItem })
  } catch (error) {
    logError(error, { route: 'doctors.unavailability.create', userId: user.id })
    return c.json(
      { error: 'Failed to create unavailability', code: 'UNAVAILABILITY_CREATE_FAILED' },
      500
    )
  }
})

// DELETE /api/doctors/unavailability/:id - Delete unavailability record
doctorsApp.delete('/unavailability/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, APPOINTMENTS_MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    await db.delete(doctorUnavailability).where(eq(doctorUnavailability.id, id))
    return c.json({ success: true })
  } catch (error) {
    logError(error, { route: 'doctors.unavailability.delete', userId: user.id, id })
    return c.json({ error: 'Failed to delete record' }, 500)
  }
})

export { doctorsApp }
