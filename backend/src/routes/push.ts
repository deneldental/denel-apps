/**
 * Web Push subscriptions — staff PWA.
 *
 * Endpoints:
 *   POST /api/push/subscribe   — register a browser's PushSubscription for the current user
 *   DELETE /api/push/unsubscribe — remove a subscription by endpoint
 *   POST /api/push/send        — admin/system: deliver a push to a list of users
 *
 * The PWA calls subscribe/unsubscribe; an admin or scheduled task calls /send.
 */

import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { pushSubscriptions } from '../db/schema'
import { ACTIONS, MODULES } from '../lib/modules'
import { sendPushToUsers } from '../lib/push'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const pushApp = new Hono<HonoEnv>()

/** POST /subscribe — body: { endpoint, keys: { p256dh, auth }, userAgent? } */
pushApp.post('/subscribe', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json().catch(() => null)
  const endpoint = body?.endpoint
  const p256dh = body?.keys?.p256dh
  const auth = body?.keys?.auth
  const userAgent = body?.userAgent ?? c.req.header('User-Agent') ?? null

  if (!endpoint || !p256dh || !auth) {
    return c.json({ error: 'endpoint, keys.p256dh, and keys.auth are required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(pushSubscriptions)
    .values({ userId: authUser.id, endpoint, p256dh, auth, userAgent })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: authUser.id, p256dh, auth, userAgent, lastUsedAt: new Date() },
    })
    .returning({ id: pushSubscriptions.id })

  return c.json({ success: true, data: { id: row.id } })
})

/** DELETE /unsubscribe — body: { endpoint } */
pushApp.delete('/unsubscribe', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json().catch(() => null)
  const endpoint = body?.endpoint
  if (!endpoint) return c.json({ error: 'endpoint is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
  return c.json({ success: true })
})

/** POST /send — admin/system: deliver a push to a list of users. */
pushApp.post('/send', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  // Push send is treated as a comms action — any module-level admin permission works.
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = await c.req.json().catch(() => null)
  const userIds: string[] = Array.isArray(body?.userIds) ? body.userIds : []
  const title: string = body?.title ?? ''
  const message: string = body?.body ?? ''
  const url: string | undefined = body?.url

  if (userIds.length === 0 || !title) {
    return c.json({ error: 'userIds[] and title are required' }, 400)
  }

  const result = await sendPushToUsers(userIds, { title, body: message, url })
  if (!result.configured) {
    return c.json(
      { error: 'Push notifications not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY missing)' },
      409
    )
  }
  return c.json({
    success: true,
    data: { sent: result.sent, removed: result.removed, attempted: result.attempted },
  })
})

/** GET /vapid-public-key — public. The VAPID application server key the browser
 *  needs for pushManager.subscribe(). Public by design (the public half of the
 *  keypair), so any client (staff or patient) can fetch it at runtime instead of
 *  depending on a build-time VITE_VAPID_PUBLIC_KEY. */
pushApp.get('/vapid-public-key', (c) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  if (!publicKey) return c.json({ error: 'Push notifications not configured' }, 409)
  return c.json({ success: true, data: { publicKey } })
})

export { pushApp }
