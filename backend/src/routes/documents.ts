/**
 * Document signing engine API — admin-v1 CC.4.
 *
 * Template registry + instance completion via two first-class paths:
 *   - digital: fill the template's fields + signatures -> flatten -> store
 *   - uploaded: upload a pre-signed scan directly as the completed record
 * Both record subject + creator + timestamp + a content hash.
 */

import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  documentFields,
  documentInstances,
  documentSigners,
  documentTemplates,
  type TemplateField,
} from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { flattenSignedPdf, sha256Hex } from '../lib/document-signing'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { readStoredFile } from '../lib/private-files'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { type FileCategory, uploadToCategory } from '../lib/storage-router'
import { issueSigningToken } from '../lib/tokens'
import type { HonoEnv } from '../lib/types'

export const documentsApp = new Hono<HonoEnv>()

const MODULE = MODULES.COMPLIANCE

function categoryFor(subjectType: string): FileCategory {
  if (subjectType === 'patient') return 'patient_records'
  if (subjectType === 'staff') return 'staff'
  return 'system_docs'
}

// ── Templates ─────────────────────────────────────────────────────────────────

// POST /templates — register a template (PDF already uploaded; field map from the editor).
documentsApp.post('/templates', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string
    category?: string
    description?: string | null
    pdfUrl?: string
    fields?: TemplateField[]
  }
  if (!body.name?.trim() || !body.category || !body.pdfUrl)
    return c.json({ error: 'name, category and pdfUrl are required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [row] = await db
      .insert(documentTemplates)
      .values({
        name: body.name.trim(),
        category: body.category,
        description: body.description ?? null,
        pdfUrl: body.pdfUrl,
        fields: body.fields ?? [],
        createdById: user.id,
      })
      .returning()
    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'compliance',
      entityId: row.id,
      entityName: `Document template: ${row.name}`,
    })
    c.set('skipAudit', true)
    return c.json({ success: true, data: row })
  } catch (error: unknown) {
    logError(error, { context: '[documents] create template' })
    return c.json({ error: 'Failed to create template' }, 500)
  }
})

// GET /templates — list active templates (optionally by category).
documentsApp.get('/templates', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const category = c.req.query('category')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const where = category
      ? and(eq(documentTemplates.isActive, true), eq(documentTemplates.category, category))
      : eq(documentTemplates.isActive, true)
    const rows = await db
      .select()
      .from(documentTemplates)
      .where(where)
      .orderBy(desc(documentTemplates.createdAt))
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: '[documents] list templates' })
    return c.json({ error: 'Failed to fetch templates' }, 500)
  }
})

// GET /templates/:id
documentsApp.get('/templates/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.id, c.req.param('id')))
    .limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

// PATCH /templates/:id — update name/description/fields/active.
documentsApp.patch('/templates/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as Partial<{
    name: string
    description: string | null
    fields: TemplateField[]
    isActive: boolean
  }>
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [row] = await db
      .update(documentTemplates)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.fields !== undefined ? { fields: body.fields } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(documentTemplates.id, c.req.param('id')))
      .returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: row })
  } catch (error: unknown) {
    logError(error, { context: '[documents] update template' })
    return c.json({ error: 'Failed to update template' }, 500)
  }
})

// ── Instances ─────────────────────────────────────────────────────────────────

// POST /instances — create a draft instance for a subject from a template.
documentsApp.post('/instances', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    templateId?: string
    subjectType?: string
    subjectId?: string
    title?: string
    signingOrder?: 'SEQUENTIAL' | 'PARALLEL'
    signers?: Array<{
      role: string
      name: string
      email: string
      order?: number
    }>
  }
  if (!body.templateId || !body.subjectType || !body.subjectId)
    return c.json({ error: 'templateId, subjectType and subjectId are required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [tpl] = await db
      .select()
      .from(documentTemplates)
      .where(eq(documentTemplates.id, body.templateId))
      .limit(1)
    if (!tpl) return c.json({ error: 'Template not found' }, 404)

    const instanceId = randomUUID()
    const signingOrder = body.signingOrder || 'SEQUENTIAL'

    // 1. Create the instance
    const [row] = await db
      .insert(documentInstances)
      .values({
        id: instanceId,
        templateId: tpl.id,
        title: body.title?.trim() || tpl.name,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        mode: 'digital',
        status: 'draft',
        signingOrder,
        createdById: user.id,
      })
      .returning()

    // 2. Insert document_signers and generate magic links
    const signersInput = body.signers || []
    const responseSigners = []
    const portalUrl = process.env.PORTAL_URL || 'http://localhost:5173'

    for (let i = 0; i < signersInput.length; i++) {
      const s = signersInput[i]
      const signerId = randomUUID()
      const order = s.order !== undefined ? s.order : i + 1

      const [signerRow] = await db
        .insert(documentSigners)
        .values({
          id: signerId,
          instanceId,
          order,
          name: s.name,
          email: s.email,
          status: 'PENDING',
        })
        .returning()

      // Generate JWT and Magic Link
      const token = await issueSigningToken(signerId)
      const magicLink = `${portalUrl}/sign/${token}`

      responseSigners.push({
        id: signerRow.id,
        name: signerRow.name,
        email: signerRow.email,
        order: signerRow.order,
        status: signerRow.status,
        magicLink,
      })

      // 3. Create matching document_fields records based on the template's fields and this signer's role
      const tplFields = (tpl.fields as TemplateField[]) || []
      for (const field of tplFields) {
        if (field.signerRole === s.role) {
          await db.insert(documentFields).values({
            instanceId,
            signerId,
            type: field.type,
            page: field.page,
            x: field.x,
            y: field.y,
            w: field.w,
            h: field.h,
          })
        }
      }
    }

    // Proactively pre-render/copy original PDF to instances location so active signer gets a valid starting PDF
    // A template that cannot be read skips the copy; the signing flow reads the
    // template again later. (Before, only an HTTP error skipped — a network
    // error failed the whole request with a 500.)
    const templateBytes = await readStoredFile(tpl.pdfUrl).catch(() => null)
    if (templateBytes) {
      const category =
        body.subjectType === 'patient'
          ? 'patient_records'
          : body.subjectType === 'staff'
            ? 'staff'
            : 'system_docs'
      const { url } = await uploadToCategory(
        category as any,
        `documents/${instanceId}.pdf`,
        Buffer.from(templateBytes),
        'application/pdf'
      )
      await db
        .update(documentInstances)
        .set({ signedPdfUrl: url })
        .where(eq(documentInstances.id, instanceId))

      row.signedPdfUrl = url
    }

    return c.json({ success: true, data: { ...row, signers: responseSigners } })
  } catch (error: unknown) {
    logError(error, { context: '[documents] create instance' })
    return c.json({ error: 'Failed to create instance' }, 500)
  }
})

// POST /instances/:id/sign — fill + flatten the template, store the signed PDF.
documentsApp.post('/instances/:id/sign', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    values?: Record<string, string>
    signers?: Array<{ role: string; name: string }>
  }
  const values = body.values ?? {}

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [inst] = await db
      .select()
      .from(documentInstances)
      .where(eq(documentInstances.id, c.req.param('id')))
      .limit(1)
    if (!inst) return c.json({ error: 'Instance not found' }, 404)
    if (inst.status === 'completed') return c.json({ error: 'Already completed' }, 409)
    if (!inst.templateId) return c.json({ error: 'Instance has no template to sign' }, 400)

    const [tpl] = await db
      .select()
      .from(documentTemplates)
      .where(eq(documentTemplates.id, inst.templateId))
      .limit(1)
    if (!tpl) return c.json({ error: 'Template not found' }, 404)

    // Fetch the source template PDF and flatten the captured values onto it.
    let templateBytes: Uint8Array
    try {
      templateBytes = await readStoredFile(tpl.pdfUrl)
    } catch {
      return c.json({ error: 'Could not load template PDF' }, 502)
    }
    const signed = await flattenSignedPdf({
      templateBytes,
      fields: (tpl.fields as TemplateField[]) ?? [],
      values,
    })
    const hash = sha256Hex(signed)

    const { url } = await uploadToCategory(
      categoryFor(inst.subjectType),
      `documents/${inst.id}.pdf`,
      Buffer.from(signed),
      'application/pdf'
    )

    const now = new Date()
    const signers = (body.signers ?? []).map((s) => ({ ...s, signedAt: now.toISOString() }))
    const [row] = await db
      .update(documentInstances)
      .set({
        status: 'completed',
        mode: 'digital',
        signedPdfUrl: url,
        contentHash: hash,
        fieldValues: values,
        signers,
        completedAt: now,
      })
      .where(eq(documentInstances.id, inst.id))
      .returning()

    // §19.3 — forensic capture of the sign+flatten event (CC.4). Carry the
    // content hash + viewer IP/UA so the audit log is the single forensic home.
    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'compliance',
      entityId: inst.id,
      entityName: `Signed document: ${inst.title}`,
      changes: { contentHash: hash, subjectType: inst.subjectType, subjectId: inst.subjectId },
      ipAddress: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
      userAgent: c.req.header('user-agent'),
    })
    c.set('skipAudit', true)
    return c.json({ success: true, data: row })
  } catch (error: unknown) {
    logError(error, { context: '[documents] sign instance' })
    return c.json({ error: 'Failed to sign document' }, 500)
  }
})

// POST /instances/upload — upload a pre-signed scan as the completed record.
documentsApp.post('/instances/upload', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const form = await c.req.formData()
    const file = form.get('file') as File | null
    const subjectType = String(form.get('subjectType') ?? '')
    const subjectId = String(form.get('subjectId') ?? '')
    const title = String(form.get('title') ?? '').trim()
    const templateId = (form.get('templateId') as string | null) || null
    if (!file || !subjectType || !subjectId || !title)
      return c.json({ error: 'file, subjectType, subjectId and title are required' }, 400)

    const bytes = new Uint8Array(await file.arrayBuffer())
    const hash = sha256Hex(bytes)
    const id = randomUUID()
    const ext = file.type === 'application/pdf' ? 'pdf' : 'bin'
    const { url } = await uploadToCategory(
      categoryFor(subjectType),
      `documents/${id}.${ext}`,
      Buffer.from(bytes),
      file.type || 'application/pdf'
    )

    const now = new Date()
    const [row] = await db
      .insert(documentInstances)
      .values({
        id,
        templateId,
        title,
        subjectType,
        subjectId,
        mode: 'uploaded',
        status: 'completed',
        signedPdfUrl: url,
        contentHash: hash,
        createdById: user.id,
        completedAt: now,
      })
      .returning()
    // §19.3 — forensic capture of the upload-signed path (CC.4).
    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'compliance',
      entityId: row.id,
      entityName: `Uploaded signed document: ${title}`,
      changes: { contentHash: hash, subjectType, subjectId },
      ipAddress: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
      userAgent: c.req.header('user-agent'),
    })
    c.set('skipAudit', true)
    return c.json({ success: true, data: row })
  } catch (error: unknown) {
    logError(error, { context: '[documents] upload instance' })
    return c.json({ error: 'Failed to upload document' }, 500)
  }
})

// GET /instances?subjectType=&subjectId= — a subject's documents.
documentsApp.get('/instances', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const subjectType = c.req.query('subjectType')
  const subjectId = c.req.query('subjectId')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const where =
      subjectType && subjectId
        ? and(
            eq(documentInstances.subjectType, subjectType),
            eq(documentInstances.subjectId, subjectId)
          )
        : undefined
    const rows = await db
      .select()
      .from(documentInstances)
      .where(where)
      .orderBy(desc(documentInstances.createdAt))
      .limit(200)
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: '[documents] list instances' })
    return c.json({ error: 'Failed to fetch documents' }, 500)
  }
})

// GET /instances/:id
documentsApp.get('/instances/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .select()
    .from(documentInstances)
    .where(eq(documentInstances.id, c.req.param('id')))
    .limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})
