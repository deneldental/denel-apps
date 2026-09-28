import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { patientOdontogram } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const odontogramApp = new Hono<HonoEnv>()

// Valid FDI tooth numbers: 11-18, 21-28, 31-38, 41-48
const VALID_TEETH = [
  ...Array.from({ length: 8 }, (_, i) => 11 + i),
  ...Array.from({ length: 8 }, (_, i) => 21 + i),
  ...Array.from({ length: 8 }, (_, i) => 31 + i),
  ...Array.from({ length: 8 }, (_, i) => 41 + i),
]

const VALID_SURFACES = ['O', 'M', 'D', 'B', 'L', 'whole']
const VALID_CONDITIONS = [
  'healthy',
  'caries',
  'filling',
  'crown',
  'root_canal',
  'extracted',
  'missing',
  'implant',
  'bridge_pontic',
  'bridge_abutment',
  'fractured',
  'sealant',
]

function validatePayload(body: any): string | null {
  if (!body.toothNumber || !VALID_TEETH.includes(body.toothNumber)) {
    return 'Invalid toothNumber. Must be FDI 11-48.'
  }
  if (!body.surface || !VALID_SURFACES.includes(body.surface)) {
    return `Invalid surface. Must be one of: ${VALID_SURFACES.join(', ')}`
  }
  if (!body.condition || !VALID_CONDITIONS.includes(body.condition)) {
    return `Invalid condition. Must be one of: ${VALID_CONDITIONS.join(', ')}`
  }
  return null
}

// GET /api/odontogram/patient/:patientId — all entries for a patient
odontogramApp.get('/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const patientId = c.req.param('patientId')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const entries = await db
      .select()
      .from(patientOdontogram)
      .where(eq(patientOdontogram.patientId, patientId))
      .orderBy(asc(patientOdontogram.toothNumber))
    return c.json({ success: true, data: entries })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// POST /api/odontogram — create entry
odontogramApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      user.id,
      MODULES.MEDICAL_RECORDS as string,
      ACTIONS.CREATE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  const err = validatePayload(body)
  if (err) return c.json({ error: err }, 400)
  if (!body.patientId) return c.json({ error: 'patientId required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const [entry] = await db
      .insert(patientOdontogram)
      .values({
        patientId: body.patientId,
        toothNumber: body.toothNumber,
        surface: body.surface,
        condition: body.condition,
        notes: body.notes ?? null,
        recordedById: user.id,
      })
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'medical_records',
      entityId: entry.id,
      entityName: `Tooth ${body.toothNumber} (${body.surface}): ${body.condition}`,
      changes: body,
    })

    return c.json({ success: true, data: entry })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// PATCH /api/odontogram/:id — update entry
odontogramApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      user.id,
      MODULES.MEDICAL_RECORDS as string,
      ACTIONS.UPDATE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  // Only allow updating condition, surface, notes — not patientId or toothNumber
  const updates: any = {}
  if (body.condition !== undefined) {
    if (!VALID_CONDITIONS.includes(body.condition)) {
      return c.json({ error: 'Invalid condition' }, 400)
    }
    updates.condition = body.condition
  }
  if (body.surface !== undefined) {
    if (!VALID_SURFACES.includes(body.surface)) {
      return c.json({ error: 'Invalid surface' }, 400)
    }
    updates.surface = body.surface
  }
  if (body.notes !== undefined) updates.notes = body.notes
  updates.updatedAt = new Date()

  try {
    const [entry] = await db
      .update(patientOdontogram)
      .set(updates)
      .where(eq(patientOdontogram.id, id))
      .returning()

    if (!entry) return c.json({ error: 'Not found' }, 404)

    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'medical_records',
      entityId: entry.id,
      entityName: `Tooth ${entry.toothNumber} (${entry.surface}): ${entry.condition}`,
      changes: updates,
    })

    return c.json({ success: true, data: entry })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// DELETE /api/odontogram/:id — delete entry
odontogramApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      user.id,
      MODULES.MEDICAL_RECORDS as string,
      ACTIONS.DELETE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const [deleted] = await db
      .delete(patientOdontogram)
      .where(eq(patientOdontogram.id, id))
      .returning()

    if (!deleted) return c.json({ error: 'Not found' }, 404)

    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: 'medical_records',
      entityId: deleted.id,
      entityName: `Tooth ${deleted.toothNumber} (${deleted.surface}): ${deleted.condition}`,
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

export { odontogramApp }
