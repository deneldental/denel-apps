/**
 * Credential expiry notifications.
 *
 * Driven by the same 15-minute scheduler tick that owns reminders. For every
 * active credential whose `reminderEnabled` is true and whose `expiryDate` is
 * within `reminderDaysBefore` days from now (or already lapsed), we notify
 * the staff member via PWA push and write an audit-log entry so we don't
 * re-notify on the next tick.
 *
 * No new schema — the dedupe key is the `audit_logs` row we write each time
 * we send. The lookup checks for any `credential_expiry_reminder` entry on
 * the same credential within the last 20 hours (gives some slack around the
 * "once a day" expectation without requiring server clock alignment).
 */

import { and, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm'
import webPush from 'web-push'
import type { DB } from '../db'
import { auditLogs, pushSubscriptions, staff, staffCredentials, staffDocuments } from '../db/schema'
import { createAuditLog } from './audit'
import { logger } from './logger'

const DEDUPE_WINDOW_MS = 20 * 60 * 60 * 1000 // 20 hours
const DEFAULT_REMINDER_DAYS = 14

/**
 * Run one pass of the credential expiry check.
 * Idempotent within the dedupe window — safe to call on every scheduler tick.
 */
export async function runCredentialExpiryCheck(db: DB, now: Date = new Date()): Promise<void> {
  // Use a window that captures both "expiring soon" and "already lapsed":
  // expiryDate <= now + max(reminderDaysBefore, DEFAULT_REMINDER_DAYS).
  // We compute per-row whether to actually fire below — this bound just keeps
  // the query small.
  const upperBound = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)

  let candidates: Array<{
    credentialId: string
    credentialType: string
    credentialName: string
    expiryDate: Date | null
    reminderDaysBefore: number | null
    staffId: string
    staffUserId: string | null
    staffName: string
  }> = []
  try {
    candidates = await db
      .select({
        credentialId: staffCredentials.id,
        credentialType: staffCredentials.credentialType,
        credentialName: staffCredentials.credentialName,
        expiryDate: staffCredentials.expiryDate,
        reminderDaysBefore: staffCredentials.reminderDaysBefore,
        staffId: staff.id,
        staffUserId: staff.userId,
        staffName: staff.fullName,
      })
      .from(staffCredentials)
      .innerJoin(staff, eq(staff.id, staffCredentials.staffId))
      .where(
        and(
          eq(staffCredentials.reminderEnabled, true),
          isNotNull(staffCredentials.expiryDate),
          lte(staffCredentials.expiryDate, upperBound),
          isNull(staff.deletedAt),
          eq(staff.status, 'active')
        )
      )
  } catch (err) {
    logger.error({ err }, '[credential-expiry] candidate fetch failed')
    return
  }

  // NOTE: do not early-return when there are no credential candidates — the
  // staff_documents expiry pass at the end of this function must still run. A
  // clinic can have expiring documents (contracts, NDAs, visas) with no
  // expiring credentials, and those reminders were silently skipped before.
  // The credential loop below is a no-op on an empty candidate list.
  const dedupeCutoff = new Date(now.getTime() - DEDUPE_WINDOW_MS)
  let sentCount = 0
  let skippedDedupe = 0

  for (const row of candidates) {
    if (!row.expiryDate) continue
    const reminderDays = row.reminderDaysBefore ?? DEFAULT_REMINDER_DAYS
    const reminderStart = new Date(row.expiryDate.getTime() - reminderDays * 24 * 60 * 60 * 1000)
    // Only fire if today is at-or-past the reminder start.
    if (now < reminderStart) continue

    // Dedupe — has a reminder for this credential gone out in the past ~20h?
    let alreadySent = false
    try {
      const recent = await db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'credential_expiry_reminder'),
            eq(auditLogs.entityId, row.credentialId),
            gte(auditLogs.createdAt, dedupeCutoff)
          )
        )
        .limit(1)
      alreadySent = recent.length > 0
    } catch (err) {
      // If the dedupe lookup fails, skip rather than risk spamming.
      logger.warn(
        { err, credentialId: row.credentialId },
        '[credential-expiry] dedupe check failed'
      )
      continue
    }
    if (alreadySent) {
      skippedDedupe++
      continue
    }

    const lapsed = row.expiryDate < now
    const daysUntilExpiry = Math.ceil(
      (row.expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
    )

    // Phase 3D — auto-suspend on lapse. Flip `suspendedDueToLapse` so the
    // booking dropdown and roster views can hide the practitioner until
    // they upload a renewal. Cleared on next document upload.
    if (lapsed) {
      try {
        await db
          .update(staffCredentials)
          .set({ suspendedDueToLapse: true, updatedAt: now })
          .where(eq(staffCredentials.id, row.credentialId))
      } catch (err) {
        logger.error(
          { err, credentialId: row.credentialId },
          '[credential-expiry] auto-suspend update failed — lapsed staff member may remain active'
        )
      }
    }

    // Push notification to the staff member (best-effort).
    if (row.staffUserId) {
      await sendPushToUser(db, row.staffUserId, {
        title: lapsed ? `${row.credentialName} has expired` : `${row.credentialName} expires soon`,
        body: lapsed
          ? `${row.credentialType} lapsed on ${formatDate(row.expiryDate)}. Upload a renewal.`
          : `${row.credentialType} expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'} (${formatDate(row.expiryDate)}).`,
        url: '/pwa/profile',
      }).catch((err) => {
        logger.warn({ err, staffUserId: row.staffUserId }, '[credential-expiry] push send failed')
      })
    }

    await createAuditLog(db, {
      userId: row.staffUserId ?? 'system',
      action: 'credential_expiry_reminder',
      module: 'staff',
      entityId: row.credentialId,
      entityName: `${row.credentialName} (${row.staffName})`,
      changes: {
        expiryDate: row.expiryDate.toISOString(),
        daysUntilExpiry,
        lapsed,
      },
    })

    sentCount++
  }

  if (sentCount > 0 || skippedDedupe > 0) {
    logger.info(
      { candidates: candidates.length, sent: sentCount, skippedDedupe },
      '[credential-expiry] tick complete'
    )
  }

  // Phase 4C — same loop for staff_documents with reminderEnabled=true.
  await runDocumentExpiryCheck(db, now)
}

/**
 * Reminder loop for general HR documents (contracts, NDAs, visas). Shares
 * the dedupe via audit_logs action `document_expiry_reminder`.
 */
async function runDocumentExpiryCheck(db: DB, now: Date): Promise<void> {
  const upperBound = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)

  let rows: Array<{
    documentId: string
    title: string
    expiryDate: Date | null
    reminderDaysBefore: number | null
    staffId: string
    staffUserId: string | null
    staffName: string
  }> = []
  try {
    rows = await db
      .select({
        documentId: staffDocuments.id,
        title: staffDocuments.title,
        expiryDate: staffDocuments.expiryDate,
        reminderDaysBefore: staffDocuments.reminderDaysBefore,
        staffId: staff.id,
        staffUserId: staff.userId,
        staffName: staff.fullName,
      })
      .from(staffDocuments)
      .innerJoin(staff, eq(staff.id, staffDocuments.staffId))
      .where(
        and(
          eq(staffDocuments.reminderEnabled, true),
          isNotNull(staffDocuments.expiryDate),
          lte(staffDocuments.expiryDate, upperBound),
          isNull(staff.deletedAt),
          eq(staff.status, 'active')
        )
      )
  } catch (err) {
    logger.error({ err }, '[document-expiry] candidate fetch failed')
    return
  }

  if (rows.length === 0) return
  const dedupeCutoff = new Date(now.getTime() - DEDUPE_WINDOW_MS)

  for (const row of rows) {
    if (!row.expiryDate) continue
    const reminderDays = row.reminderDaysBefore ?? DEFAULT_REMINDER_DAYS
    const reminderStart = new Date(row.expiryDate.getTime() - reminderDays * 24 * 60 * 60 * 1000)
    if (now < reminderStart) continue

    try {
      const recent = await db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'document_expiry_reminder'),
            eq(auditLogs.entityId, row.documentId),
            gte(auditLogs.createdAt, dedupeCutoff)
          )
        )
        .limit(1)
      if (recent.length > 0) continue
    } catch {
      continue
    }

    const lapsed = row.expiryDate < now
    const daysUntilExpiry = Math.ceil(
      (row.expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
    )

    if (row.staffUserId) {
      await sendPushToUser(db, row.staffUserId, {
        title: lapsed ? `${row.title} has expired` : `${row.title} expires soon`,
        body: lapsed
          ? `Document expired on ${formatDate(row.expiryDate)}. Upload a renewal.`
          : `Document expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}.`,
        url: '/pwa/documents',
      }).catch((err) => {
        logger.warn({ err, staffUserId: row.staffUserId }, '[document-expiry] push send failed')
      })
    }

    await createAuditLog(db, {
      userId: row.staffUserId ?? 'system',
      action: 'document_expiry_reminder',
      module: 'staff',
      entityId: row.documentId,
      entityName: `${row.title} (${row.staffName})`,
      changes: { expiryDate: row.expiryDate.toISOString(), daysUntilExpiry, lapsed },
    })
  }
}

async function sendPushToUser(
  db: DB,
  userId: string,
  notification: { title: string; body: string; url?: string }
): Promise<void> {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))

  if (subs.length === 0) return

  const payload = JSON.stringify(notification)
  for (const sub of subs) {
    try {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
      await db
        .update(pushSubscriptions)
        .set({ lastUsedAt: new Date() })
        .where(eq(pushSubscriptions.id, sub.id))
        .catch(() => {})
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        // Dead subscription — clean it up so we stop trying.
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.id, sub.id))
          .catch(() => {})
      }
    }
  }
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })
}
