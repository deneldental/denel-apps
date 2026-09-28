/**
 * ICD-10 codes — admin-v1 CC.1.
 *
 * Read-only reference lookup (WHO ICD-10, curated dental favourites today, full
 * set behind search later). Consumed by the diagnosis picker (§2.2) and the
 * Services ICD link (§6.1).
 */

import { ilike, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { icd10Codes } from '../db/schema'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

export const icd10CodesApp = new Hono<HonoEnv>()

// GET /?q=&limit= — search by code prefix or title substring.
icd10CodesApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PATIENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const q = (c.req.query('q') ?? '').trim()
  const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit') ?? '25', 10) || 25, 1), 100)

  try {
    const rows = await db
      .select()
      .from(icd10Codes)
      .where(q ? or(ilike(icd10Codes.code, `${q}%`), ilike(icd10Codes.title, `%${q}%`)) : undefined)
      .orderBy(icd10Codes.code)
      .limit(limit)
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: '[icd10-codes] search' })
    return c.json({ error: 'Failed to fetch ICD-10 codes' }, 500)
  }
})
