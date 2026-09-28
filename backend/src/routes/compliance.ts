import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { complianceDocumentRenewals, complianceDocuments } from '../db/schema'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const complianceApp = new Hono<HonoEnv>()

/** List all compliance documents */
complianceApp.get('/', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(c, authUser.id, MODULES.COMPLIANCE as string, ACTIONS.READ as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const data = await db.query.complianceDocuments.findMany({
      orderBy: [desc(complianceDocuments.createdAt)],
    })
    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: '[compliance] list error' })
    return c.json({ error: 'Failed to fetch compliance documents' }, 500)
  }
})

/** Create compliance document */
complianceApp.post('/', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(c, authUser.id, MODULES.COMPLIANCE as string, ACTIONS.CREATE as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    const [doc] = await db
      .insert(complianceDocuments)
      .values({
        documentName: body.documentName,
        category: body.category,
        documentUrl: body.documentUrl || null,
        dateIssued: body.dateIssued ? new Date(body.dateIssued) : null,
        dateExpired: body.dateExpired ? new Date(body.dateExpired) : null,
        reminderEnabled: body.reminderEnabled ?? false,
        reminderMonthsBefore: body.reminderMonthsBefore ?? 3,
        reminderPhones: body.reminderPhones || [],
        reminderMessage: body.reminderMessage || null,
        issuingAuthority: body.issuingAuthority || null,
        notes: body.notes || null,
        createdById: authUser.id,
      })
      .returning()

    return c.json({ success: true, data: doc })
  } catch (error: unknown) {
    logError(error, { context: '[compliance] create error' })
    return c.json({ error: 'Failed to create compliance document' }, 500)
  }
})

/** Update compliance document */
complianceApp.patch('/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(c, authUser.id, MODULES.COMPLIANCE as string, ACTIONS.UPDATE as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    const patch: Record<string, any> = { updatedAt: new Date() }
    if (body.documentName !== undefined) patch.documentName = body.documentName
    if (body.category !== undefined) patch.category = body.category
    if (body.documentUrl !== undefined) patch.documentUrl = body.documentUrl
    if (body.dateIssued !== undefined)
      patch.dateIssued = body.dateIssued ? new Date(body.dateIssued) : null
    if (body.dateExpired !== undefined)
      patch.dateExpired = body.dateExpired ? new Date(body.dateExpired) : null
    if (body.reminderEnabled !== undefined) patch.reminderEnabled = body.reminderEnabled
    if (body.reminderMonthsBefore !== undefined)
      patch.reminderMonthsBefore = body.reminderMonthsBefore
    if (body.reminderPhones !== undefined) patch.reminderPhones = body.reminderPhones
    if (body.reminderMessage !== undefined) patch.reminderMessage = body.reminderMessage
    if (body.issuingAuthority !== undefined) patch.issuingAuthority = body.issuingAuthority
    if (body.notes !== undefined) patch.notes = body.notes

    const [updated] = await db
      .update(complianceDocuments)
      .set(patch)
      .where(eq(complianceDocuments.id, id))
      .returning()

    if (!updated) return c.json({ error: 'Document not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: '[compliance] update error' })
    return c.json({ error: 'Failed to update compliance document' }, 500)
  }
})

/** Delete compliance document */
complianceApp.delete('/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(c, authUser.id, MODULES.COMPLIANCE as string, ACTIONS.DELETE as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    await db.delete(complianceDocuments).where(eq(complianceDocuments.id, id))
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to delete document' }, 500)
  }
})

/** Get a single compliance document by id with renewals */
complianceApp.get('/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(c, authUser.id, MODULES.COMPLIANCE as string, ACTIONS.READ as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    const data = await db.query.complianceDocuments.findFirst({
      where: eq(complianceDocuments.id, id),
      with: {
        renewals: {
          orderBy: (ren, { desc }) => [desc(ren.uploadedAt)],
        },
      },
    })

    if (!data) return c.json({ error: 'Document not found' }, 404)
    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: '[compliance] get single error' })
    return c.json({ error: 'Failed to fetch compliance document' }, 500)
  }
})

/** Add a renewal to a compliance document */
complianceApp.post('/:id/renewals', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(c, authUser.id, MODULES.COMPLIANCE as string, ACTIONS.UPDATE as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const documentId = c.req.param('id')
    const body = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    const result = await db.transaction(async (tx) => {
      // 1. Insert the renewal
      const [renewal] = await tx
        .insert(complianceDocumentRenewals)
        .values({
          documentId,
          documentUrl: body.documentUrl,
          receiptUrl: body.receiptUrl || null,
          amountPaid: body.amountPaid || null,
          expiryDate: new Date(body.expiryDate),
          notes: body.notes || null,
          uploadedById: authUser.id,
        })
        .returning()

      // 2. Update the parent compliance document
      await tx
        .update(complianceDocuments)
        .set({
          documentUrl: body.documentUrl,
          dateExpired: new Date(body.expiryDate),
          updatedAt: new Date(),
        })
        .where(eq(complianceDocuments.id, documentId))

      return renewal
    })

    return c.json({ success: true, data: result })
  } catch (error: unknown) {
    logError(error, { context: '[compliance] renewal create error' })
    return c.json({ error: 'Failed to add document renewal' }, 500)
  }
})

export { complianceApp }
