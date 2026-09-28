import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { patientPerioEntries } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const perioApp = new Hono<HonoEnv>()

const VALID_TEETH = [
  ...Array.from({ length: 8 }, (_, i) => 11 + i),
  ...Array.from({ length: 8 }, (_, i) => 21 + i),
  ...Array.from({ length: 8 }, (_, i) => 31 + i),
  ...Array.from({ length: 8 }, (_, i) => 41 + i),
]
const VALID_SITES = ['MB', 'B', 'DB', 'ML', 'L', 'DL']

// GET /api/perio-chart/patient/:patientId — grouped by examId, latest first
perioApp.get('/patient/:patientId', async (c) => {
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
      .from(patientPerioEntries)
      .where(eq(patientPerioEntries.patientId, patientId))
      .orderBy(desc(patientPerioEntries.recordedAt))

    // Group by examId
    const exams: Record<string, { examId: string; recordedAt: string; entries: typeof entries }> =
      {}
    for (const e of entries) {
      const recordedAtStr =
        e.recordedAt instanceof Date ? e.recordedAt.toISOString() : String(e.recordedAt)
      if (!exams[e.examId]) {
        exams[e.examId] = { examId: e.examId, recordedAt: recordedAtStr, entries: [] }
      }
      exams[e.examId].entries.push(e)
    }

    const grouped = Object.values(exams).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    return c.json({ success: true, data: grouped })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// POST /api/perio-chart — save a new perio exam
// Body: { patientId, examId, readings: [{ toothNumber, site, pocketDepth }, ...] }
perioApp.post('/', async (c) => {
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
  if (!body.patientId || !body.examId || !Array.isArray(body.readings)) {
    return c.json({ error: 'patientId, examId and readings array required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)

  // Validate each reading
  for (const r of body.readings) {
    if (!VALID_TEETH.includes(r.toothNumber))
      return c.json({ error: `Invalid toothNumber: ${r.toothNumber}` }, 400)
    if (!VALID_SITES.includes(r.site)) return c.json({ error: `Invalid site: ${r.site}` }, 400)
    if (typeof r.pocketDepth !== 'number' || r.pocketDepth < 0 || r.pocketDepth > 20) {
      return c.json({ error: `Invalid pocketDepth: ${r.pocketDepth}` }, 400)
    }
  }

  try {
    const inserted = await db
      .insert(patientPerioEntries)
      .values(
        body.readings.map((r: any) => ({
          patientId: body.patientId,
          examId: body.examId,
          toothNumber: r.toothNumber,
          site: r.site,
          pocketDepth: r.pocketDepth,
          recordedById: user.id,
        }))
      )
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'medical_records',
      entityId: body.examId,
      entityName: `Perio exam (${inserted.length} readings)`,
      changes: { examId: body.examId, count: inserted.length },
    })

    return c.json({ success: true, data: { examId: body.examId, count: inserted.length } })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// DELETE /api/perio-chart/exam/:examId — remove an entire exam
perioApp.delete('/exam/:examId', async (c) => {
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

  const examId = c.req.param('examId')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const deleted = await db
      .delete(patientPerioEntries)
      .where(eq(patientPerioEntries.examId, examId))
      .returning()
    if (deleted.length === 0) return c.json({ error: 'Not found' }, 404)

    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: 'medical_records',
      entityId: examId,
      entityName: `Perio exam (${deleted.length} readings)`,
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

export { perioApp }
