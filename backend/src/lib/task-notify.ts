/**
 * Task assignment notifications — shared by the assign route and the
 * repeat-reminder cron. Resolves each assignee's phone + linked user, sends an
 * SMS + Web Push, and stamps the relevant timestamp. Best-effort: failures are
 * logged, never thrown.
 */

import { inArray } from 'drizzle-orm'
import type { getDb } from '../db'
import { staff, taskAssignments } from '../db/schema'
import { logError } from './logger'
import { sendPushToUsers } from './push'
import { sendSMS } from './sms'
import { renderSms, resolveSmsTemplate } from './sms-templates'

type Db = ReturnType<typeof getDb>

export interface NotifyTask {
  id: string
  title: string
  dueAt: Date | null
}

export interface NotifyTarget {
  id: string
  staffId: string | null
  userId: string | null
}

function formatDue(dueAt: Date | null): string {
  if (!dueAt) return ''
  try {
    return ` (due ${dueAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})`
  } catch {
    return ''
  }
}

export async function notifyTaskAssignees(
  db: Db,
  task: NotifyTask,
  targets: NotifyTarget[],
  opts: { reminder?: boolean } = {}
): Promise<void> {
  if (targets.length === 0) return

  const staffIds = targets.map((t) => t.staffId).filter((x): x is string => !!x)
  const userIds = targets.map((t) => t.userId).filter((x): x is string => !!x)

  // Resolve phones/users best-effort: this module promises never to throw, so a
  // read failure here must not bubble up and fail the caller (e.g. the create
  // route, whose task is already committed by this point).
  let staffRows: { id: string; userId: string | null; phone: string | null }[]
  let staffByUserId: { id: string; userId: string | null; phone: string | null }[]
  try {
    staffRows = staffIds.length
      ? await db
          .select({ id: staff.id, userId: staff.userId, phone: staff.phone })
          .from(staff)
          .where(inArray(staff.id, staffIds))
      : []
    staffByUserId = userIds.length
      ? await db
          .select({ id: staff.id, userId: staff.userId, phone: staff.phone })
          .from(staff)
          .where(inArray(staff.userId, userIds))
      : []
  } catch (err) {
    logError(err, { context: '[task-notify] resolve assignees' })
    return
  }

  const staffById = new Map(staffRows.map((s) => [s.id, s]))
  const staffForUser = new Map(
    staffByUserId.filter((s) => s.userId).map((s) => [s.userId as string, s])
  )

  const verb = opts.reminder ? 'Reminder' : 'New task'
  const template = await resolveSmsTemplate(
    db,
    opts.reminder ? 'task:reminder' : 'task:new',
    `${verb}: {title}{due}. Open the app to view.`
  )
  const message = renderSms(template, { title: task.title, due: formatDue(task.dueAt) })
  const smsRecipients: { phone: string; message: string }[] = []
  const pushUserIds: string[] = []
  const ids: string[] = []

  for (const t of targets) {
    const resolved = t.staffId
      ? staffById.get(t.staffId)
      : t.userId
        ? staffForUser.get(t.userId)
        : undefined
    const targetUserId = t.userId ?? resolved?.userId ?? null
    const phone = resolved?.phone ?? null
    if (phone) smsRecipients.push({ phone, message })
    if (targetUserId) pushUserIds.push(targetUserId)
    ids.push(t.id)
  }

  try {
    if (smsRecipients.length) await sendSMS(smsRecipients, undefined, 'task')
  } catch (err) {
    logError(err, { context: '[task-notify] sms' })
  }
  try {
    if (pushUserIds.length)
      await sendPushToUsers(pushUserIds, {
        title: opts.reminder ? 'Task reminder' : 'New task',
        body: task.title,
        url: '/tasks',
      })
  } catch (err) {
    logError(err, { context: '[task-notify] push' })
  }

  // Initial assignment stamps notifiedAt; a reminder stamps lastReminderAt
  // (so the cron paces the next reminder by cadence).
  const stamp = opts.reminder ? { lastReminderAt: new Date() } : { notifiedAt: new Date() }
  if (ids.length) {
    await db
      .update(taskAssignments)
      .set(stamp)
      .where(inArray(taskAssignments.id, ids))
      .catch((err) => logError(err, { context: '[task-notify] stamp' }))
  }
}
