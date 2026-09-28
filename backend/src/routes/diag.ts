import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { env } from '../config/env'
import { getDb } from '../db'
import { getCurrentUser, isAdmin } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const diagApp = new Hono<HonoEnv>()

diagApp.get('/', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, currentUser.id))) return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(env.DATABASE_URL)

  try {
    const tablesResult = await db.execute(sql`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        `)

    const tables = tablesResult.rows.map((r: any) => r.table_name)

    const counts: Record<string, number> = {}
    for (const table of ['patients', 'payment_plans', 'account', 'treatment_types']) {
      if (tables.includes(table)) {
        const countRes = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM "${table}"`))
        counts[table] = parseInt(countRes.rows[0].cnt as string, 10)
      }
    }

    return c.json({
      success: true,
      tables,
      counts,
    })
  } catch {
    return c.json({ success: false, error: 'Failed' }, 500)
  }
})

export { diagApp }
