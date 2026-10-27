import { randomBytes } from 'node:crypto'
import { and, eq, ilike, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { orthoConsentForms, patients } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { generateFileName } from '../lib/file-naming'
import { ACTIONS, MODULES } from '../lib/modules'
import { hasOrthoTag, patientIsOrtho } from '../lib/patient-tags-query'
import { processUploadedConsentForm, validateConsentFormUpload } from '../lib/pdf-utils'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { uploadToCategory } from '../lib/storage-router'
import type { HonoEnv } from '../lib/types'

const orthoConsentApp = new Hono<HonoEnv>()

orthoConsentApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.ORTHO_CONSENT as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const searchTerm = c.req.query('searchTerm')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const whereConditions = searchTerm
      ? and(
          hasOrthoTag(patients.id),
          or(
            ilike(patients.name, `%${searchTerm}%`),
            ilike(patients.patientId, `%${searchTerm}%`),
            ilike(patients.phone, `%${searchTerm}%`)
          )
        )
      : hasOrthoTag(patients.id)

    const results = await db
      .select({
        patient: patients,
        consentForm: orthoConsentForms,
      })
      .from(patients)
      .leftJoin(orthoConsentForms, eq(patients.id, orthoConsentForms.patientId))
      .where(whereConditions)

    const data = results.map((row) => ({
      id: row.patient.id,
      patientId: row.patient.patientId,
      name: row.patient.name,
      phone: row.patient.phone,
      email: row.patient.email,
      profileImage: row.patient.profileImage,
      consentFormId: row.consentForm?.id ?? null,
      consentFormUrl: row.consentForm?.consentFormUrl ?? null,
      status: row.consentForm?.status || 'unsigned',
      uploadedAt: row.consentForm?.uploadedAt ?? null,
      notes: row.consentForm?.notes ?? null,
      createdAt: row.patient.createdAt,
    }))

    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

orthoConsentApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.ORTHO_CONSENT as string, ACTIONS.CREATE as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const patient = await db.query.patients.findFirst({
      where: eq(patients.id, body.patientId),
    })

    if (!patient) return c.json({ error: 'Invalid patient' }, 400)
    if (!(await patientIsOrtho(db, patient.id))) return c.json({ error: 'Invalid patient' }, 400)

    const existingForm = await db.query.orthoConsentForms.findFirst({
      where: eq(orthoConsentForms.patientId, body.patientId),
    })

    if (existingForm) {
      await db
        .update(orthoConsentForms)
        .set({
          consentFormUrl: body.consentFormUrl,
          status: 'signed',
          uploadedById: user.id,
          uploadedAt: new Date(),
          notes: body.notes || null,
          updatedAt: new Date(),
        })
        .where(eq(orthoConsentForms.id, existingForm.id))
    } else {
      await db.insert(orthoConsentForms).values({
        patientId: body.patientId,
        consentFormUrl: body.consentFormUrl,
        status: 'signed',
        uploadedById: user.id,
        uploadedAt: new Date(),
        notes: body.notes || null,
      })
    }

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'upload',
      module: 'ortho_consent_forms',
      entityId: body.patientId,
      entityName: patient.name,
      changes: { status: { before: existingForm?.status || 'unsigned', after: 'signed' } },
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

orthoConsentApp.post('/process', async (c) => {
  try {
    const user = await getCurrentUser(c)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (
      !(await checkPermission(
        c,
        user.id,
        MODULES.ORTHO_CONSENT as string,
        ACTIONS.CREATE as string
      ))
    )
      return c.json({ error: 'Unauthorized' }, 403)

    const formData = await c.req.formData()
    const file = formData.get('file') as File
    const patientName = formData.get('patientName') as string

    if (!file || !patientName) return c.json({ error: 'Missing required fields' }, 400)
    if (file.type !== 'application/pdf') return c.json({ error: 'Only PDF allowed' }, 400)

    const arrayBuffer = await file.arrayBuffer()
    const validation = await validateConsentFormUpload(arrayBuffer)
    if (!validation.valid) return c.json({ error: validation.error }, 400)
    const templateBaseUrl = process.env.PDF_TEMPLATE_BASE_URL
    if (!templateBaseUrl) {
      return c.json({ error: 'PDF_TEMPLATE_BASE_URL not configured' }, 500)
    }
    const processedBuffer = await processUploadedConsentForm(arrayBuffer, templateBaseUrl)
    // `<name>_<ddMMMyyyy>.pdf` is readable, and it is NOT unique: two patients of the same name on
    // one day, or one patient twice, would write to the same key and a plain PutObject overwrites,
    // so the earlier signed form would be replaced by someone else's. Random bits make it theirs.
    const fileName = (await generateFileName(patientName, new Date(), 'pdf')).replace(/\.pdf$/, '')

    const key = `consent-forms/${fileName}-${randomBytes(8).toString('hex')}.pdf`
    const result = await uploadToCategory(
      'patient_records',
      key,
      Buffer.from(processedBuffer),
      'application/pdf'
    )

    return c.json({ success: true, url: result.url })
  } catch (_error: unknown) {
    return c.json({ error: 'Process failed' }, 500)
  }
})

orthoConsentApp.patch('/:patientId/delete', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.ORTHO_CONSENT as string, ACTIONS.DELETE as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const patientId = c.req.param('patientId')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const patient = await db.query.patients.findFirst({ where: eq(patients.id, patientId) })
    if (!patient) return c.json({ error: 'Not found' }, 404)

    await db
      .update(orthoConsentForms)
      .set({
        status: 'unsigned',
        consentFormUrl: null,
        notes: null,
        updatedAt: new Date(),
      })
      .where(eq(orthoConsentForms.patientId, patientId))

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: 'ortho_consent_forms',
      entityId: patientId,
      entityName: patient.name,
      changes: { status: { before: 'signed', after: 'unsigned' } },
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

export { orthoConsentApp }
