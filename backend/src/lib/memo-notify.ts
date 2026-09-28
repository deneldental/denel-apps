/**
 * Memo publish notifications — shared by the publish route and the
 * "notify unread" nudge. Resolves each target staff member's phone + linked
 * user, sends a Web Push (always) + SMS (only for important/critical memos, to
 * keep cost down), and is best-effort: failures are logged, never thrown.
 */

import { inArray } from 'drizzle-orm'
import type { getDb } from '../db'
import { staff } from '../db/schema'
import { logError } from './logger'
import { sendPushToUsers } from './push'
import { sendSMS } from './sms'
import { renderSms, resolveSmsTemplate } from './sms-templates'

type Db = ReturnType<typeof getDb>

export interface NotifyMemo {
  id: string
  title: string
  level: string | null
}

/**
 * Notify the given target staff about a memo. `push` always fires; `sms` only
 * fires when the memo is important/critical (these warrant the cost + intrusion).
 * `opts.reminder` flips the copy to a nudge for unread recipients.
 *
 * Returns delivery counts so the caller can surface "pushed to N / texted M".
 */
export async function notifyMemoStaff(
  db: Db,
  memo: NotifyMemo,
  staffIds: string[],
  opts: { reminder?: boolean } = {}
): Promise<{ pushed: number; texted: number }> {
  const ids = [...new Set(staffIds.filter(Boolean))]
  if (ids.length === 0) return { pushed: 0, texted: 0 }

  const rows = await db
    .select({ id: staff.id, userId: staff.userId, phone: staff.phone })
    .from(staff)
    .where(inArray(staff.id, ids))

  const userIds = rows.map((r) => r.userId).filter((x): x is string => !!x)
  const highPriority = memo.level === 'important' || memo.level === 'critical'

  const verb = opts.reminder ? 'Reminder' : 'New memo'
  const pushTitle = opts.reminder ? 'Memo reminder' : 'New memo'

  let pushed = 0
  try {
    if (userIds.length) {
      const res = await sendPushToUsers(userIds, {
        title: pushTitle,
        body: memo.title,
        url: '/memos',
      })
      pushed = res.sent
    }
  } catch (err) {
    logError(err, { context: '[memo-notify] push' })
  }

  let texted = 0
  if (highPriority) {
    const template = await resolveSmsTemplate(
      db,
      opts.reminder ? 'memo:reminder' : 'memo:new',
      `${verb}: {title}. Open the app to read.`
    )
    const message = renderSms(template, { title: memo.title })
    const smsRecipients = rows
      .map((r) => r.phone)
      .filter((p): p is string => !!p)
      .map((phone) => ({ phone, message }))
    try {
      if (smsRecipients.length) {
        await sendSMS(smsRecipients, undefined, 'memo')
        texted = smsRecipients.length
      }
    } catch (err) {
      logError(err, { context: '[memo-notify] sms' })
    }
  }

  return { pushed, texted }
}
