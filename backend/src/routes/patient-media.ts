import { and, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { patientDocuments, patientPhotos } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const patientMediaApp = new Hono<HonoEnv>()

const PHOTO_CATEGORIES = ['intraoral', 'portrait', 'before', 'after']
const DOC_CATEGORIES = ['insurance_card', 'id', 'consent', 'other']

// Helper: check view permission based on clinicalScope
async function _canView(c: any, userId: string, clinicalScope: boolean) {
  if (clinicalScope) {
    return await checkPermission(
      c,
      userId,
      MODULES.MEDICAL_RECORDS as string,
      ACTIONS.READ as string
    )
  }
  return await checkPermission(c, userId, MODULES.PATIENTS as string, ACTIONS.READ as string)
}

// ─── PHOTOS ──────────────────────────────────────────────────────────────────

// GET /api/patient-media/photos/patient/:patientId
patientMediaApp.get('/photos/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const patientId = c.req.param('patientId')

  const [hasMedPerm, hasPatPerm] = await Promise.all([
    checkPermission(c, user.id, MODULES.MEDICAL_RECORDS as string, ACTIONS.READ as string),
    checkPermission(c, user.id, MODULES.PATIENTS as string, ACTIONS.READ as string),
  ])

  // Translate the per-row scope check into a single SQL predicate so we don't
  // pull rows the caller can't see — was an O(N) fetch-then-filter before.
  const allowedScopes: boolean[] = []
  if (hasMedPerm) allowedScopes.push(true)
  if (hasPatPerm) allowedScopes.push(false)
  if (allowedScopes.length === 0) return c.json({ success: true, data: [] })

  const visible = await db
    .select()
    .from(patientPhotos)
    .where(
      and(
        eq(patientPhotos.patientId, patientId),
        inArray(patientPhotos.clinicalScope, allowedScopes)
      )
    )
    .orderBy(desc(patientPhotos.uploadedAt))

  return c.json({ success: true, data: visible })
})

// POST /api/patient-media/photos
patientMediaApp.post('/photos', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json()
  if (!body.patientId || !body.imageUrl || !body.category) {
    return c.json({ error: 'patientId, imageUrl and category required' }, 400)
  }
  if (!PHOTO_CATEGORIES.includes(body.category)) {
    return c.json(
      { error: `Invalid category. Must be one of: ${PHOTO_CATEGORIES.join(', ')}` },
      400
    )
  }

  const clinicalScope =
    body.clinicalScope !== undefined ? !!body.clinicalScope : body.category !== 'portrait'
  const requiredModule = clinicalScope ? MODULES.MEDICAL_RECORDS : MODULES.PATIENTS
  if (!(await checkPermission(c, user.id, requiredModule as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [photo] = await db
      .insert(patientPhotos)
      .values({
        patientId: body.patientId,
        category: body.category,
        clinicalScope,
        imageUrl: body.imageUrl,
        thumbnailUrl: body.thumbnailUrl ?? null,
        capturedAt: body.capturedAt ? new Date(body.capturedAt) : null,
        linkedRecordId: body.linkedRecordId ?? null,
        notes: body.notes ?? null,
        uploadedById: user.id,
      })
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: clinicalScope ? 'medical_records' : 'patients',
      entityId: photo.id,
      entityName: `Photo: ${body.category}`,
      changes: { category: body.category, clinicalScope },
    })

    return c.json({ success: true, data: photo })
  } catch (error) {
    logError(error, { route: 'patient-media', userId: user.id })
    return c.json({ error: 'Operation failed', code: 'PATIENT_MEDIA_FAILED' }, 500)
  }
})

// DELETE /api/patient-media/photos/:id
patientMediaApp.delete('/photos/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  const [existing] = await db.select().from(patientPhotos).where(eq(patientPhotos.id, id)).limit(1)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const requiredModule = existing.clinicalScope ? MODULES.MEDICAL_RECORDS : MODULES.PATIENTS
  if (!(await checkPermission(c, user.id, requiredModule as string, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  try {
    await db.delete(patientPhotos).where(eq(patientPhotos.id, id))
    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: existing.clinicalScope ? 'medical_records' : 'patients',
      entityId: id,
      entityName: `Photo: ${existing.category}`,
    })
    return c.json({ success: true })
  } catch (error) {
    logError(error, { route: 'patient-media', userId: user.id })
    return c.json({ error: 'Operation failed', code: 'PATIENT_MEDIA_FAILED' }, 500)
  }
})

// ─── DOCUMENTS ───────────────────────────────────────────────────────────────

// GET /api/patient-media/documents/patient/:patientId
patientMediaApp.get('/documents/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const patientId = c.req.param('patientId')

  const [hasMedPerm, hasPatPerm] = await Promise.all([
    checkPermission(c, user.id, MODULES.MEDICAL_RECORDS as string, ACTIONS.READ as string),
    checkPermission(c, user.id, MODULES.PATIENTS as string, ACTIONS.READ as string),
  ])

  const allowedScopes: boolean[] = []
  if (hasMedPerm) allowedScopes.push(true)
  if (hasPatPerm) allowedScopes.push(false)
  if (allowedScopes.length === 0) return c.json({ success: true, data: [] })

  const visible = await db
    .select()
    .from(patientDocuments)
    .where(
      and(
        eq(patientDocuments.patientId, patientId),
        inArray(patientDocuments.clinicalScope, allowedScopes)
      )
    )
    .orderBy(desc(patientDocuments.uploadedAt))

  return c.json({ success: true, data: visible })
})

// POST /api/patient-media/documents
patientMediaApp.post('/documents', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json()
  if (!body.patientId || !body.fileUrl || !body.fileName || !body.category) {
    return c.json({ error: 'patientId, fileUrl, fileName and category required' }, 400)
  }
  if (!DOC_CATEGORIES.includes(body.category)) {
    return c.json({ error: `Invalid category. Must be one of: ${DOC_CATEGORIES.join(', ')}` }, 400)
  }

  const clinicalScope =
    body.clinicalScope !== undefined ? !!body.clinicalScope : body.category === 'consent'
  const requiredModule = clinicalScope ? MODULES.MEDICAL_RECORDS : MODULES.PATIENTS
  if (!(await checkPermission(c, user.id, requiredModule as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [doc] = await db
      .insert(patientDocuments)
      .values({
        patientId: body.patientId,
        category: body.category,
        clinicalScope,
        fileName: body.fileName,
        fileUrl: body.fileUrl,
        fileSize: body.fileSize ?? null,
        mimeType: body.mimeType ?? null,
        notes: body.notes ?? null,
        uploadedById: user.id,
      })
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: clinicalScope ? 'medical_records' : 'patients',
      entityId: doc.id,
      entityName: `Document: ${body.fileName}`,
      changes: { category: body.category, clinicalScope },
    })

    return c.json({ success: true, data: doc })
  } catch (error) {
    logError(error, { route: 'patient-media', userId: user.id })
    return c.json({ error: 'Operation failed', code: 'PATIENT_MEDIA_FAILED' }, 500)
  }
})

// DELETE /api/patient-media/documents/:id
patientMediaApp.delete('/documents/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  const [existing] = await db
    .select()
    .from(patientDocuments)
    .where(eq(patientDocuments.id, id))
    .limit(1)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const requiredModule = existing.clinicalScope ? MODULES.MEDICAL_RECORDS : MODULES.PATIENTS
  if (!(await checkPermission(c, user.id, requiredModule as string, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  try {
    await db.delete(patientDocuments).where(eq(patientDocuments.id, id))
    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: existing.clinicalScope ? 'medical_records' : 'patients',
      entityId: id,
      entityName: `Document: ${existing.fileName}`,
    })
    return c.json({ success: true })
  } catch (error) {
    logError(error, { route: 'patient-media', userId: user.id })
    return c.json({ error: 'Operation failed', code: 'PATIENT_MEDIA_FAILED' }, 500)
  }
})

export { patientMediaApp }
