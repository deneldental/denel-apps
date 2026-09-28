import { and, eq, lt } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { documentFields, documentInstances, documentSigners } from '../db/schema'
import { maybeCompleteDocument, stampFieldsAndSave } from '../lib/document-signing'
import { verifySigningToken } from '../lib/tokens'
import type { HonoEnv } from '../lib/types'

export const signingApp = new Hono<HonoEnv>()

// GET /api/sign/:token
signingApp.get('/:token', async (c) => {
  const token = c.req.param('token')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const { signerId } = await verifySigningToken(token)

    // Find the signer
    const [signer] = await db
      .select()
      .from(documentSigners)
      .where(eq(documentSigners.id, signerId))
      .limit(1)

    if (!signer) {
      return c.json({ error: 'Signer not found' }, 404)
    }

    // Find the instance
    const [instance] = await db
      .select()
      .from(documentInstances)
      .where(eq(documentInstances.id, signer.instanceId))
      .limit(1)

    if (!instance) {
      return c.json({ error: 'Document instance not found' }, 404)
    }

    // Sequential guard check
    if (instance.signingOrder === 'SEQUENTIAL') {
      const pendingPriorSigners = await db
        .select()
        .from(documentSigners)
        .where(
          and(
            eq(documentSigners.instanceId, instance.id),
            lt(documentSigners.order, signer.order),
            eq(documentSigners.status, 'PENDING')
          )
        )
      if (pendingPriorSigners.length > 0) {
        return c.json({ error: 'It is not your turn to sign this document yet.' }, 403)
      }
    }

    // Get fields specifically for this signer
    const fields = await db
      .select()
      .from(documentFields)
      .where(
        and(eq(documentFields.instanceId, instance.id), eq(documentFields.signerId, signer.id))
      )

    return c.json({
      success: true,
      signer: {
        id: signer.id,
        name: signer.name,
        email: signer.email,
        status: signer.status,
        order: signer.order,
      },
      instance: {
        id: instance.id,
        title: instance.title,
        status: instance.status,
        signingOrder: instance.signingOrder,
        signedPdfUrl: instance.signedPdfUrl,
      },
      fields: fields.map((f) => ({
        id: f.id,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        w: f.w,
        h: f.h,
        value: f.value,
      })),
    })
  } catch (error: any) {
    return c.json({ error: error.message || 'Verification failed' }, 400)
  }
})

// POST /api/sign/:token
signingApp.post('/:token', async (c) => {
  const token = c.req.param('token')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const { signerId } = await verifySigningToken(token)

    // Find the signer
    const [signer] = await db
      .select()
      .from(documentSigners)
      .where(eq(documentSigners.id, signerId))
      .limit(1)

    if (!signer) {
      return c.json({ error: 'Signer not found' }, 404)
    }

    if (signer.status === 'SIGNED') {
      return c.json({ error: 'You have already signed this document.' }, 400)
    }

    // Find the instance
    const [instance] = await db
      .select()
      .from(documentInstances)
      .where(eq(documentInstances.id, signer.instanceId))
      .limit(1)

    if (!instance) {
      return c.json({ error: 'Document instance not found' }, 404)
    }

    // Sequential guard check
    if (instance.signingOrder === 'SEQUENTIAL') {
      const pendingPriorSigners = await db
        .select()
        .from(documentSigners)
        .where(
          and(
            eq(documentSigners.instanceId, instance.id),
            lt(documentSigners.order, signer.order),
            eq(documentSigners.status, 'PENDING')
          )
        )
      if (pendingPriorSigners.length > 0) {
        return c.json({ error: 'It is not your turn to sign this document yet.' }, 403)
      }
    }

    const body = await c.req.json().catch(() => ({}))
    const fieldsUpdate = body.fields || [] // array of { id: string, value: string }

    // Update individual fields
    let signatureValue: string | null = null
    for (const f of fieldsUpdate) {
      if (!f.id) continue

      // Update DB record
      await db
        .update(documentFields)
        .set({ value: f.value })
        .where(
          and(
            eq(documentFields.id, f.id),
            eq(documentFields.signerId, signer.id),
            eq(documentFields.instanceId, instance.id)
          )
        )

      // Keep track if this was the signature image
      const [fieldRecord] = await db
        .select()
        .from(documentFields)
        .where(eq(documentFields.id, f.id))
        .limit(1)
      if (
        fieldRecord &&
        (fieldRecord.type === 'signature' || fieldRecord.type === 'initials') &&
        f.value
      ) {
        signatureValue = f.value
      }
    }

    // Update signer status to SIGNED
    const now = new Date()
    const ipAddress = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null
    const userAgent = c.req.header('user-agent') || null

    await db
      .update(documentSigners)
      .set({
        status: 'SIGNED',
        signedAt: now,
        ipAddress,
        userAgent,
        ...(signatureValue ? { signatureImageUrl: signatureValue } : {}),
      })
      .where(eq(documentSigners.id, signer.id))

    // Trigger visual PDF stamping
    await stampFieldsAndSave(instance.id, db)

    // Trigger completion check
    await maybeCompleteDocument(instance.id, db)

    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: error.message || 'Signing failed' }, 400)
  }
})
