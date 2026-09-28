/**
 * Web Push delivery helper — shared by the /api/push/send route and any
 * server-side notifier (e.g. task assignment) that needs to push to users.
 *
 * VAPID is configured lazily on first send so a missing key doesn't crash boot.
 */

import { eq, inArray } from 'drizzle-orm'
import webPush from 'web-push'
import { getDb } from '../db'
import { pushSubscriptions } from '../db/schema'
import { logError } from './logger'

let webPushConfigured = false
export function configureWebPush(): boolean {
  if (webPushConfigured) return true
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:info@deneldental.com'
  if (!publicKey || !privateKey) return false
  webPush.setVapidDetails(subject, publicKey, privateKey)
  webPushConfigured = true
  return true
}

export interface PushPayload {
  title: string
  body?: string
  url?: string
}

export interface PushSendResult {
  sent: number
  removed: number
  attempted: number
  configured: boolean
}

type Sub = typeof pushSubscriptions.$inferSelect

/**
 * Deliver a payload to a resolved list of subscriptions. Dead subscriptions
 * (404/410) are pruned; other per-subscription errors are logged but never fail
 * the whole send. Shared by the staff (userId) and patient (patientId) senders.
 */
async function deliver(subs: Sub[], payload: PushPayload): Promise<PushSendResult> {
  if (subs.length === 0) return { sent: 0, removed: 0, attempted: 0, configured: true }

  const db = getDb(process.env.DATABASE_URL!)
  const body = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url })
  let sent = 0
  let removed = 0

  for (const s of subs) {
    try {
      await webPush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body
      )
      sent++
      await db
        .update(pushSubscriptions)
        .set({ lastUsedAt: new Date() })
        .where(eq(pushSubscriptions.id, s.id))
        .catch(() => {})
    } catch (err: unknown) {
      const httpErr = err as { statusCode?: number }
      if (httpErr.statusCode === 404 || httpErr.statusCode === 410) {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.id, s.id))
          .catch(() => {})
        removed++
      }
      logError(err, { context: '[push/send]', statusCode: httpErr.statusCode })
    }
  }

  return { sent, removed, attempted: subs.length, configured: true }
}

/**
 * Deliver a push notification to every subscription owned by the given staff
 * users. Returns delivery counts.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<PushSendResult> {
  const unique = [...new Set(userIds.filter(Boolean))]
  if (unique.length === 0 || !payload.title) {
    return { sent: 0, removed: 0, attempted: 0, configured: true }
  }
  if (!configureWebPush()) return { sent: 0, removed: 0, attempted: 0, configured: false }

  const db = getDb(process.env.DATABASE_URL!)
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, unique))
  return deliver(subs, payload)
}

/**
 * Deliver a push notification to every subscription owned by the given patients
 * (the patient app). Same pruning/error semantics as the staff sender.
 */
export async function sendPushToPatients(
  patientIds: string[],
  payload: PushPayload
): Promise<PushSendResult> {
  const unique = [...new Set(patientIds.filter(Boolean))]
  if (unique.length === 0 || !payload.title) {
    return { sent: 0, removed: 0, attempted: 0, configured: true }
  }
  if (!configureWebPush()) return { sent: 0, removed: 0, attempted: 0, configured: false }

  const db = getDb(process.env.DATABASE_URL!)
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.patientId, unique))
  return deliver(subs, payload)
}
