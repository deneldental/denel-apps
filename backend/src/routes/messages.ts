import { eq, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { messages } from '../db/schema'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const messagesApp = new Hono<HonoEnv>()

const MODULE = MODULES.MESSAGING

messagesApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const data = await db.query.messages.findMany({
      where: or(eq(messages.senderId, user.id), eq(messages.receiverId, user.id)),
      with: { sender: true, receiver: true },
      orderBy: (messages, { desc }) => [desc(messages.createdAt)],
    })
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

messagesApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { receiverId, content } = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  try {
    await db.insert(messages).values({
      senderId: user.id,
      receiverId,
      content,
    })
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

export { messagesApp }
