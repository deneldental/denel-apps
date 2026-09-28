/**
 * Consent Form Library — Phase 7.5
 * Template CRUD + patient signatures with content snapshot.
 */

import { asc, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { consentFormTemplates, patients, signedConsentForms } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { ACTIONS, MODULES } from '../lib/modules'
import { getPendingConsents } from '../lib/pending-consents-service'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const consentFormsApp = new Hono<HonoEnv>()

// ═════════════════════════════════════════════════════════════════════════════
// Templates
// ═════════════════════════════════════════════════════════════════════════════

consentFormsApp.get('/templates', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.COMPLIANCE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.select().from(consentFormTemplates).orderBy(asc(consentFormTemplates.name))
  return c.json({ success: true, data: rows })
})

consentFormsApp.get('/templates/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.COMPLIANCE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .select()
    .from(consentFormTemplates)
    .where(eq(consentFormTemplates.id, c.req.param('id')))
    .limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

consentFormsApp.post('/templates', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.COMPLIANCE as string, ACTIONS.CREATE as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  if (!body.name || !body.content) return c.json({ error: 'name and content required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(consentFormTemplates)
    .values({
      name: body.name,
      category: body.category ?? null,
      content: body.content,
      requiresSignature: body.requiresSignature ?? true,
      requiresWitness: body.requiresWitness ?? false,
      active: body.active ?? true,
      createdById: user.id,
    })
    .returning()
  return c.json({ success: true, data: row })
})

consentFormsApp.patch('/templates/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.COMPLIANCE as string, ACTIONS.UPDATE as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)
  const updates: any = { updatedAt: new Date() }
  for (const k of [
    'name',
    'category',
    'content',
    'requiresSignature',
    'requiresWitness',
    'active',
  ]) {
    if (body[k] !== undefined) updates[k] = body[k]
  }
  const [row] = await db
    .update(consentFormTemplates)
    .set(updates)
    .where(eq(consentFormTemplates.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

consentFormsApp.delete('/templates/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.COMPLIANCE as string, ACTIONS.DELETE as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .delete(consentFormTemplates)
    .where(eq(consentFormTemplates.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

// ═════════════════════════════════════════════════════════════════════════════
// Signed forms
// ═════════════════════════════════════════════════════════════════════════════

consentFormsApp.get('/signed', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.COMPLIANCE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select({
      id: signedConsentForms.id,
      patientId: signedConsentForms.patientId,
      patientName: patients.name,
      templateId: signedConsentForms.templateId,
      templateName: consentFormTemplates.name,
      consentType: consentFormTemplates.category,
      signedAt: signedConsentForms.signedAt,
      signedByName: signedConsentForms.signedByName,
    })
    .from(signedConsentForms)
    .leftJoin(patients, eq(patients.id, signedConsentForms.patientId))
    .leftJoin(consentFormTemplates, eq(consentFormTemplates.id, signedConsentForms.templateId))
    .orderBy(desc(signedConsentForms.signedAt))
  return c.json({ success: true, data: rows })
})

consentFormsApp.get('/signed/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.COMPLIANCE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const patientId = c.req.param('patientId')
  const rows = await db.query.signedConsentForms.findMany({
    where: eq(signedConsentForms.patientId, patientId),
    orderBy: [desc(signedConsentForms.signedAt)],
    with: { template: true },
  })
  return c.json({ success: true, data: rows })
})

// ═════════════════════════════════════════════════════════════════════════════
// Pending consents — §18.2 ("consent due")
// ═════════════════════════════════════════════════════════════════════════════

const pendingQuerySchema = z.object({
  // Scope to a single patient (e.g. a pre-procedure chart check).
  patientId: z.string().uuid().optional(),
  // 'true' (default) → only patients with an upcoming appointment;
  // 'false' → every patient (heavy; explicit "all outstanding" reporting).
  upcomingOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
})

// GET /pending — required consents a patient has NOT yet signed before a
// procedure. Default scope: patients with an upcoming appointment.
consentFormsApp.get('/pending', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.COMPLIANCE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const parsed = pendingQuerySchema.safeParse({
    patientId: c.req.query('patientId'),
    upcomingOnly: c.req.query('upcomingOnly'),
  })
  if (!parsed.success) {
    return c.json({ error: 'Invalid query', details: parsed.error.flatten() }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const data = await getPendingConsents(db, {
    patientId: parsed.data.patientId,
    upcomingOnly: parsed.data.upcomingOnly,
  })
  const totalPending = data.reduce((sum, r) => sum + r.pending.length, 0)
  return c.json({ success: true, data, totalPending })
})

consentFormsApp.get('/signed/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.COMPLIANCE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .select()
    .from(signedConsentForms)
    .where(eq(signedConsentForms.id, c.req.param('id')))
    .limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

// POST /signed — record a signed form
// Body: { templateId, patientId, signatureData, signedByName, relationshipToPatient?, witnessName?, witnessSignatureData?, notes? }
consentFormsApp.post('/signed', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.COMPLIANCE as string, ACTIONS.CREATE as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  if (!body.templateId || !body.patientId || !body.signatureData || !body.signedByName) {
    return c.json({ error: 'templateId, patientId, signatureData, signedByName required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const [template] = await db
    .select()
    .from(consentFormTemplates)
    .where(eq(consentFormTemplates.id, body.templateId))
    .limit(1)
  if (!template) return c.json({ error: 'Invalid template' }, 400)

  const [row] = await db
    .insert(signedConsentForms)
    .values({
      templateId: body.templateId,
      patientId: body.patientId,
      signatureData: body.signatureData,
      signedByName: body.signedByName,
      relationshipToPatient: body.relationshipToPatient ?? 'self',
      witnessName: body.witnessName ?? null,
      witnessSignatureData: body.witnessSignatureData ?? null,
      contentSnapshot: template.content,
      collectedById: user.id,
      notes: body.notes ?? null,
    })
    .returning()

  await createAuditLog(db, {
    userId: user.id,
    action: 'create',
    module: 'compliance',
    entityId: row.id,
    entityName: `Signed consent: ${template.name}`,
    changes: { templateId: body.templateId, signedByName: body.signedByName },
  })

  return c.json({ success: true, data: row })
})

export { consentFormsApp }
