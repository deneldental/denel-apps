/**
 * Daily task reminders.
 *
 * Re-notifies assignees of still-open (pending) tasks that have a repeat
 * cadence set (`daily` / `weekly`). Runs once a day; a daily task reminds each
 * run, a weekly task reminds when its last reminder is ~7 days old. Completed
 * assignments and one-off (`none`) tasks are never reminded.
 */

import { and, eq, ne } from 'drizzle-orm'
import { env } from '../../../config/env'
import { getDb } from '../../../db'
import { taskAssignments, tasks } from '../../../db/schema'
import { notifyTaskAssignees } from '../../task-notify'
import type { JobContext, JobRunResult } from '../types'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export async function runTaskReminders(ctx: JobContext): Promise<JobRunResult> {
  const db = getDb(env.DATABASE_URL)
  const now = ctx.firedAt.getTime()
  // Pace by cadence, with slack so a slightly-early/late run still fires:
  //  daily  → remind if last reminder was >20h ago (≈ once per daily run)
  //  weekly → remind if last reminder was >6.5 days ago
  const dailyCutoff = now - 20 * HOUR
  const weeklyCutoff = now - 6.5 * DAY

  const rows = await db
    .select({
      id: taskAssignments.id,
      staffId: taskAssignments.staffId,
      userId: taskAssignments.userId,
      lastReminderAt: taskAssignments.lastReminderAt,
      taskId: tasks.id,
      title: tasks.title,
      dueAt: tasks.dueAt,
      repeat: tasks.repeat,
    })
    .from(taskAssignments)
    .innerJoin(tasks, eq(taskAssignments.taskId, tasks.id))
    .where(and(eq(taskAssignments.status, 'pending'), ne(tasks.repeat, 'none')))

  const due = rows.filter((r) => {
    const cutoff = r.repeat === 'weekly' ? weeklyCutoff : dailyCutoff
    return !r.lastReminderAt || new Date(r.lastReminderAt).getTime() < cutoff
  })

  if (due.length === 0) return { summary: 'no task reminders due' }

  // Group by task so each task's recipients are resolved + messaged together.
  const byTask = new Map<string, { title: string; dueAt: Date | null; targets: typeof due }>()
  for (const r of due) {
    const entry = byTask.get(r.taskId) ?? { title: r.title, dueAt: r.dueAt, targets: [] }
    entry.targets.push(r)
    byTask.set(r.taskId, entry)
  }

  for (const [taskId, { title, dueAt, targets }] of byTask) {
    await notifyTaskAssignees(
      db,
      { id: taskId, title, dueAt },
      targets.map((t) => ({ id: t.id, staffId: t.staffId, userId: t.userId })),
      { reminder: true }
    )
  }

  ctx.log(`sent ${due.length} task reminders across ${byTask.size} tasks`)
  return {
    summary: `reminded ${due.length} assignment(s) on ${byTask.size} task(s)`,
    details: { reminded: due.length, tasks: byTask.size },
  }
}
