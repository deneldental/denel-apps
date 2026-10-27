import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import {
  medicalRecords,
  patients,
  pendingMedicalRecords,
  recarePlans,
  treatmentTypes,
  user as userSchema,
} from '../db/schema'
import { createAuditLog, recordDiffAudit } from '../lib/audit'
import { resolveDoctorIdForUser } from '../lib/doctor-identity'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { ensurePendingMedicalRecord } from '../lib/pending-medical-record-service'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { denyUnless } from '../lib/route-access'
import type { HonoEnv } from '../lib/types'

// ── Zod schemas for medical record write handlers ─────────────────────────────
// Excluded (server-owned): id, createdById, createdAt, updatedAt

const CreateMedicalRecordSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  date: z.string().optional(),
  treatmentTypeId: z.string().uuid().nullish(),
  complaint: z.string().nullish(),
  examination: z.string().nullish(),
  diagnosis: z.string().nullish(),
  treatment: z.string().nullish(),
  prescription: z.string().nullish(),
  notes: z.string().nullish(),
  attachments: z.string().nullish(),
})

const CreatePendingSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  appointmentId: z.string().uuid().nullish(),
})

const UpdateMedicalRecordSchema = z.object({
  date: z.string().optional(),
  treatmentTypeId: z.string().uuid().nullish(),
  complaint: z.string().nullish(),
  examination: z.string().nullish(),
  diagnosis: z.string().nullish(),
  treatment: z.string().nullish(),
  prescription: z.string().nullish(),
  notes: z.string().nullish(),
  attachments: z.string().nullish(),
  // reason is used only for the audit log, not stored in the medical_records table
  reason: z.string().nullish(),
})

const medicalRecordsApp = new Hono<HonoEnv>()

// Delete-only now (see DELETE /:id below) — every other handler in this file
// went through the RBAC engine via checkPermission() instead. Kept as a
// hardcoded role check for delete specifically because `medical_records:delete`
// isn't a grantable permission on ANY bundle today, not even the doctor's own
// (bundle_clinical_doctor stops at read/create/update) — swapping it to
// checkPermission would silently take delete away from doctors, a real
// behaviour change nobody asked for. See project-docs/patient-records-and-scheduling-audit.md C6.
async function isDoctorOrAdmin(db: any, userId: string): Promise<boolean> {
  const user = await db.query.user.findFirst({
    where: eq(userSchema.id, userId),
    with: { role: true },
  })
  return user?.role?.id === 'admin' || user?.role?.id === 'doctor'
}

medicalRecordsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1)
    const limit = Math.min(
      200,
      Math.max(1, Number.parseInt(c.req.query('limit') ?? '100', 10) || 100)
    )
    const offset = (page - 1) * limit

    const [data, countRows] = await Promise.all([
      db.query.medicalRecords.findMany({
        with: { patient: true, doctor: { with: { user: true } } },
        limit,
        offset,
      }),
      db.select({ total: count() }).from(medicalRecords),
    ])

    const total = countRows[0]?.total ?? 0
    return c.json({ success: true, data, total, limit, page })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch records' }, 500)
  }
})

medicalRecordsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS, ACTIONS.CREATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  c.set('skipAudit', true)
  try {
    const parsed = CreateMedicalRecordSchema.safeParse(await c.req.json())
    if (!parsed.success)
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    const data = parsed.data

    // Ensure date is a Date object for Drizzle
    const recordDate = data.date ? new Date(data.date) : new Date()

    const [newItem] = await db
      .insert(medicalRecords)
      .values({
        patientId: data.patientId,
        doctorId: data.doctorId,
        date: recordDate,
        treatmentTypeId: data.treatmentTypeId ?? null,
        complaint: data.complaint ?? null,
        examination: data.examination ?? null,
        diagnosis: data.diagnosis ?? null,
        treatment: data.treatment ?? null,
        prescription: data.prescription ?? null,
        notes: data.notes ?? null,
        attachments: data.attachments ?? null,
        createdById: user.id,
      })
      .returning()

    if (data.patientId && data.doctorId) {
      await db
        .update(pendingMedicalRecords)
        .set({ status: 'completed', completedAt: new Date() })
        .where(
          and(
            eq(pendingMedicalRecords.patientId, data.patientId),
            eq(pendingMedicalRecords.doctorId, data.doctorId),
            eq(pendingMedicalRecords.status, 'pending')
          )
        )
    }

    // ── Phase 2.1: auto-create recare if treatmentType has defaultRecareMonths ─
    if (data.treatmentTypeId && data.patientId) {
      try {
        const [type] = await db
          .select()
          .from(treatmentTypes)
          .where(eq(treatmentTypes.id, data.treatmentTypeId))
          .limit(1)
        if (type?.defaultRecareMonths) {
          // Complete any pending treatment-scope recare plans for this patient + treatment type
          await db
            .update(recarePlans)
            .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(recarePlans.patientId, data.patientId),
                eq(recarePlans.treatmentTypeId, data.treatmentTypeId),
                inArray(recarePlans.status, ['pending', 'alerted'])
              )
            )

          // Create a new patient-scope recare plan for the next follow-up
          const completionDate =
            newItem.date instanceof Date ? newItem.date : new Date(newItem.date)
          const dueDate = new Date(completionDate)
          dueDate.setMonth(dueDate.getMonth() + type.defaultRecareMonths)
          await db.insert(recarePlans).values({
            patientId: data.patientId,
            scopeType: 'patient',
            treatmentTypeId: data.treatmentTypeId,
            durationValue: type.defaultRecareMonths,
            durationUnit: 'months',
            recurrence: 'one_time',
            nextAlertDate: dueDate,
            isActive: true,
            status: 'pending',
            createdById: newItem.createdById ?? user.id,
            notes: `Auto-created from medical record — ${type.displayName || type.name}`,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        }
      } catch (err) {
        logError(err, { context: '[medical-records] auto-recare failed' })
        // Non-fatal — continue
      }
    }

    const patient = await db.query.patients.findFirst({
      where: eq(patients.id, data.patientId),
    })

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'medical-records',
      entityId: newItem.id,
      entityName: patient ? `Medical Record for ${patient.name}` : 'Medical Record',
      changes: data,
    })

    return c.json({ success: true, data: newItem })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to create record' }, 500)
  }
})

medicalRecordsApp.get('/pending', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const doctorId = c.req.query('doctorId')
    let targetDoctorId = doctorId

    if (!targetDoctorId) {
      // Both linkage shapes — see lib/doctor-identity.ts. Checking
      // doctors.userId alone silently returned every doctor's pending records
      // to a specialist-sourced doctor instead of just their own.
      targetDoctorId = (await resolveDoctorIdForUser(db, user.id)) ?? undefined
    }

    const data = await db.query.pendingMedicalRecords.findMany({
      where: targetDoctorId
        ? and(
            eq(pendingMedicalRecords.status, 'pending'),
            eq(pendingMedicalRecords.doctorId, targetDoctorId)
          )
        : eq(pendingMedicalRecords.status, 'pending'),
      with: { patient: true, doctor: { with: { user: true } }, appointment: true },
      orderBy: [desc(pendingMedicalRecords.checkedInAt)],
    })
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// POST /pending — queue a pending medical record when a patient is checked in
// (walk-in or scheduled). Needs `appointments:update` (checking a patient in is an appointment
// action), NOT isDoctorOrAdmin: the front desk checks patients in, so receptionists must be able to
// create these, and the Team app has no part in it. Idempotent via the service fn, so a
// retried/duplicated check-in won't double-queue.
medicalRecordsApp.post('/pending', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const denied = await denyUnless(c, user.id, {
    apps: ['portal'],
    anyOf: [[MODULES.APPOINTMENTS, ACTIONS.UPDATE]],
  })
  if (denied) return denied

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const parsed = CreatePendingSchema.safeParse(await c.req.json())
    if (!parsed.success)
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)

    const record = await ensurePendingMedicalRecord(db, parsed.data)
    return c.json({ success: true, data: record })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to create pending record' }, 500)
  }
})

medicalRecordsApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  try {
    const record = await db.query.medicalRecords.findFirst({
      where: eq(medicalRecords.id, id),
      with: { patient: true, doctor: { with: { user: true } } },
    })

    if (!record) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: record })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch record' }, 500)
  }
})

medicalRecordsApp.get('/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const patientId = c.req.param('patientId')
  try {
    const records = await db.query.medicalRecords.findMany({
      where: eq(medicalRecords.patientId, patientId),
      with: { doctor: { with: { user: true } } },
      orderBy: [desc(medicalRecords.date)],
    })
    return c.json({ success: true, data: records })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch records' }, 500)
  }
})

medicalRecordsApp.post('/pending/:id/complete', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  try {
    c.set('skipAudit', true)

    const pending = await db.query.pendingMedicalRecords.findFirst({
      where: eq(pendingMedicalRecords.id, id),
      with: { patient: true },
    })

    await db
      .update(pendingMedicalRecords)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(pendingMedicalRecords.id, id))

    await createAuditLog(db, {
      userId: user.id,
      action: 'complete_pending',
      module: 'medical-records',
      entityId: id,
      entityName: pending?.patient
        ? `Pending Record for ${pending.patient.name}`
        : 'Pending Record',
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to complete record' }, 500)
  }
})

medicalRecordsApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  try {
    const parsed = UpdateMedicalRecordSchema.safeParse(await c.req.json())
    if (!parsed.success)
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    const data = parsed.data
    c.set('skipAudit', true)

    // BEFORE snapshot for diff
    const before = await db.query.medicalRecords.findFirst({
      where: eq(medicalRecords.id, id),
      with: { patient: true },
    })
    if (!before) return c.json({ error: 'Record not found' }, 404)

    const [updated] = await db
      .update(medicalRecords)
      .set({
        ...(data.date !== undefined ? { date: new Date(data.date!) } : {}),
        ...(data.treatmentTypeId !== undefined ? { treatmentTypeId: data.treatmentTypeId } : {}),
        ...(data.complaint !== undefined ? { complaint: data.complaint } : {}),
        ...(data.examination !== undefined ? { examination: data.examination } : {}),
        ...(data.diagnosis !== undefined ? { diagnosis: data.diagnosis } : {}),
        ...(data.treatment !== undefined ? { treatment: data.treatment } : {}),
        ...(data.prescription !== undefined ? { prescription: data.prescription } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.attachments !== undefined ? { attachments: data.attachments } : {}),
        updatedAt: new Date(),
      })
      .where(eq(medicalRecords.id, id))
      .returning()

    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: 'medical_records',
      entityId: id,
      entityName: before.patient ? `Medical Record for ${before.patient.name}` : 'Medical Record',
      // Strip nested relations before storing (only raw columns)
      before: { ...before, patient: undefined },
      after: updated,
      reason: data.reason ?? null,
    })

    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to update record' }, 500)
  }
})

medicalRecordsApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  if (!(await isDoctorOrAdmin(db, user.id))) return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  try {
    c.set('skipAudit', true)

    const record = await db.query.medicalRecords.findFirst({
      where: eq(medicalRecords.id, id),
      with: { patient: true },
    })
    if (!record) return c.json({ error: 'Record not found' }, 404)

    const reason = c.req.query('reason') ?? null

    await db.delete(medicalRecords).where(eq(medicalRecords.id, id))

    await recordDiffAudit(db, {
      userId: user.id,
      action: 'delete',
      module: 'medical_records',
      entityId: id,
      entityName: record.patient ? `Medical Record for ${record.patient.name}` : 'Medical Record',
      before: { ...record, patient: undefined },
      after: null,
      reason,
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to delete record' }, 500)
  }
})

export { medicalRecordsApp }
