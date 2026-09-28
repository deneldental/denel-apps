import { asc, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Hono } from 'hono'
import { Pool } from 'pg'
import { getDb } from '../db'
import { patients, syncLog, syncRules, treatmentTypes } from '../db/schema'
import { ACTIONS, MODULES } from '../lib/modules'
import { partitionByTags } from '../lib/patient-tags-query'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const syncApp = new Hono<HonoEnv>()

syncApp.post('/patients', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.DATA_SYNC as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { connectionString, types, singlePatientId } = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  try {
    let sourcePatients: any[] = []
    if (singlePatientId) {
      sourcePatients = await db.select().from(patients).where(eq(patients.id, singlePatientId))
    } else {
      // §2.7: the old patient "types" (ortho/general/external) are now derived from
      // the patient_tags junction. Ortho = has the 'Ortho' tag; External = has the
      // 'External' tag; General = neither. Fetch the rows, then classify them
      // against their tag membership in-memory (one flat junction query).
      const allPatients = await db.select().from(patients)
      const { ortho, external } = await partitionByTags(
        db,
        allPatients.map((p) => p.id)
      )
      sourcePatients = allPatients.filter((p) => {
        const isOrtho = types.includes('ortho') && ortho.has(p.id)
        const isExternal = types.includes('external') && external.has(p.id)
        const isGeneral = types.includes('general') && !ortho.has(p.id) && !external.has(p.id)
        return isOrtho || isGeneral || isExternal
      })
    }

    if (sourcePatients.length === 0) return c.json({ success: true, message: 'No patients found' })

    const destDb = drizzle(new Pool({ connectionString, ssl: { rejectUnauthorized: false } }))

    let synced = 0
    let failed = 0
    const errors: string[] = []

    for (const patient of sourcePatients) {
      try {
        await destDb.insert(patients).values(patient).onConflictDoUpdate({
          target: patients.id,
          set: patient,
        })
        synced++
      } catch (err: unknown) {
        failed++
        errors.push(`${patient.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return c.json({
      success: failed === 0,
      message: `Synced ${synced}, failed ${failed}`,
      details: { total: sourcePatients.length, synced, failed, errors },
    })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

syncApp.get('/treatment-types', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.DATA_SYNC as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const types = await db.query.treatmentTypes.findMany({
      where: eq(treatmentTypes.autoSyncEnabled, true),
    })
    return c.json({ success: true, data: types })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

syncApp.patch('/treatment-types/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.DATA_SYNC as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const { enabled } = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)
  try {
    await db
      .update(treatmentTypes)
      .set({ autoSyncEnabled: enabled })
      .where(eq(treatmentTypes.id, id))
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

syncApp.get('/history', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.DATA_SYNC as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const limit = parseInt(c.req.query('limit') || '50', 10)
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const data = await db.query.syncLog.findMany({ limit, orderBy: [desc(syncLog.syncedAt)] })
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// ── Sync Rules ────────────────────────────────────────────────────────────────

syncApp.get('/rules', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.DATA_SYNC as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.select().from(syncRules).orderBy(asc(syncRules.entity))
  return c.json({ success: true, data: rows })
})

syncApp.patch('/rules/:entity', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.DATA_SYNC as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const entity = c.req.param('entity')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  const updates: any = { updatedAt: new Date() }
  if (body.enabled !== undefined) updates.enabled = body.enabled
  if (body.filterCustom !== undefined) updates.filterCustom = body.filterCustom
  if (body.filterOptions !== undefined) updates.filterOptions = body.filterOptions

  // Upsert: create row if it doesn't exist yet
  const [row] = await db
    .insert(syncRules)
    .values({ entity, ...updates, createdAt: new Date() })
    .onConflictDoUpdate({ target: syncRules.entity, set: updates })
    .returning()
  return c.json({ success: true, data: row })
})

export { syncApp }
