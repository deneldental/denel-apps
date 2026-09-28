import { eq } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { isDevEnvironment } from '../config/env'
import { getDb } from '../db'
import {
  appointments,
  medicalRecords,
  patients,
  paymentPlans,
  payments,
  pendingMedicalRecords,
} from '../db/schema'
import { logError } from '../lib/logger'
import { ROLES } from '../lib/modules'
import { getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const seedApp = new Hono<HonoEnv>()

/**
 * L2 — these routes do not exist outside local development.
 *
 * `DELETE /api/seed/clear` deletes every patient, appointment, medical record,
 * payment and payment plan. It shipped in the production bundle, reachable by
 * anyone holding the admin role — one mis-click, one stolen admin session, or
 * one confused-deputy bug away from wiping the clinic's clinical history. Admin
 * is an everyday operational role here, not a break-glass one; it is not a
 * sufficient guard for an unrecoverable, whole-database delete.
 *
 * A 404 (not a 403) so the endpoint is indistinguishable from one that was
 * never built.
 */
seedApp.use('*', async (c, next) => {
  if (!isDevEnvironment()) return c.json({ error: 'Not found' }, 404)
  return next()
})

async function checkAdmin(c: Context<HonoEnv>) {
  const user = await getCurrentUser(c)
  if (!user) return null
  return user.roleId === ROLES.ADMIN ? user : null
}

/** POST /api/seed/populate — insert test patients, appointments, medical records, payments */
seedApp.post('/populate', async (c) => {
  const user = await checkAdmin(c)
  if (!user) return c.json({ error: 'Unauthorized. Admin only.' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const MOCK_PHONE = '0553424972'

  try {
    // Require at least one doctor
    const existingDoctors = await db.query.doctors.findMany({ limit: 1 })
    if (existingDoctors.length === 0) {
      return c.json({ success: false, error: 'No doctors exist. Create a doctor user first.' }, 400)
    }
    const primaryDoctorId = existingDoctors[0].id

    // Determine next patient ID
    const lastPatient = await db.query.patients.findFirst({
      orderBy: (p, { desc }) => [desc(p.id)],
    })

    let nextId = 1
    if (lastPatient?.patientId) {
      const m = lastPatient.patientId.match(/FDM(\d+)/)
      if (m) nextId = parseInt(m[1], 10) + 1
    }

    const firstNames = [
      'Kwame',
      'Ama',
      'Kofi',
      'Abena',
      'Yaw',
      'Yaa',
      'Kojo',
      'Efua',
      'Akwasi',
      'Akosua',
    ]
    const lastNames = [
      'Mensah',
      'Osei',
      'Appiah',
      'Owusu',
      'Boateng',
      'Anim',
      'Asante',
      'Agyemang',
      'Boakye',
      'Opoku',
    ]
    const now = new Date()

    for (let i = 0; i < 10; i++) {
      const patientId = `#FDM${nextId.toString().padStart(6, '0')}`
      nextId++

      const [patient] = await db
        .insert(patients)
        .values({
          name: `${firstNames[i]} ${lastNames[i]}`,
          phone: MOCK_PHONE,
          dob: new Date(
            1980 + Math.floor(Math.random() * 30),
            Math.floor(Math.random() * 12),
            Math.floor(Math.random() * 28) + 1
          ),
          gender: i % 2 === 0 ? 'male' : 'female',
          address: `House No. ${Math.floor(Math.random() * 100)}, Accra`,
          occupation: ['Teacher', 'Engineer', 'Banker', 'Trader', 'Student'][
            Math.floor(Math.random() * 5)
          ],
          patientId,
          isChild: false,
          // §2.7 — type/isOrtho are no longer seeded; DB defaults apply and
          // tags drive classification.
        })
        .returning()

      const numApts = Math.floor(Math.random() * 2) + 1
      for (let j = 0; j < numApts; j++) {
        const date = new Date(now.getTime() - Math.floor(Math.random() * 30) * 24 * 60 * 60 * 1000)

        const [appointment] = await db
          .insert(appointments)
          .values({
            patientId: patient.id,
            doctorId: primaryDoctorId,
            date,
            durationMinutes: 30,
            status: 'completed',
            type: 'consultation',
          })
          .returning()

        await db.insert(medicalRecords).values({
          patientId: patient.id,
          doctorId: primaryDoctorId,
          createdById: user.id,
          date,
          complaint: 'Routine checkup and general pain',
          examination: 'Vitals normal. Slight inflammation.',
          diagnosis: 'General malaise',
          treatment: 'Prescribed rest and painkillers',
        })

        const existingPayment = await db.query.payments.findFirst({
          where: eq(payments.appointmentId, appointment.id),
        })

        if (!existingPayment) {
          const seedAmount = Math.floor(Math.random() * 500) + 100
          await db.insert(payments).values({
            patientId: patient.id,
            appointmentId: appointment.id,
            amount: seedAmount,
            method: ['cash', 'momo', 'card'][Math.floor(Math.random() * 3)],
            status: 'posted',
            allocatedAmount: 0,
            unallocatedAmount: seedAmount,
            description: 'Consultation Fee',
          })
        }
      }
    }

    return c.json({
      success: true,
      message: '10 test patients with appointments and payments created.',
    })
  } catch (error: unknown) {
    logError(error, { context: '[Seed] Error' })
    return c.json({ success: false, error: 'Failed' }, 500)
  }
})

/** DELETE /api/seed/clear — delete all transactional data (keeps users, roles, lookup tables) */
seedApp.delete('/clear', async (c) => {
  const user = await checkAdmin(c)
  if (!user) return c.json({ error: 'Unauthorized. Admin only.' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    await db.delete(payments)
    await db.delete(paymentPlans)
    await db.delete(pendingMedicalRecords)
    await db.delete(medicalRecords)
    await db.delete(appointments)
    await db.delete(patients)
    return c.json({ success: true, message: 'All transactional data cleared.' })
  } catch (error: unknown) {
    logError(error, { context: '[Seed] Clear error' })
    return c.json({ success: false, error: 'Failed' }, 500)
  }
})

export { seedApp }
