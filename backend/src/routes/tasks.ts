/**
 * Tasks Management — general task assignment with SMS + Web Push notifications.
 *
 * Admin (HR) endpoints are gated by the STAFF module; assignee endpoints
 * (`/mine`, marking an assignment done) authorize against the caller's own
 * staff/user identity. Each assignee is notified + tracked individually.
 */

import { count, desc, eq, inArray, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { staff, taskAssignments, tasks, user } from '../db/schema'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { notifyTaskAssignees } from '../lib/task-notify'
import type { HonoEnv } from '../lib/types'

const taskApp = new Hono<HonoEnv>()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TITLE = 200
const MAX_DESCRIPTION = 2000
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 1000

/** Clamp a `?limit=` param to [1, MAX_LIMIT], defaulting to DEFAULT_LIMIT. */
function parseLimit(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_LIMIT) : DEFAULT_LIMIT
}

/** Parse a non-negative `?offset=` param, defaulting to 0. */
function parseOffset(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// ── POST / — create a task and assign it (admin) ────────────────────────────
taskApp.post('/', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = await c.req.json().catch(() => null)
  const title: string = (body?.title ?? '').trim()
  if (!title) return c.json({ error: 'title is required' }, 400)
  if (title.length > MAX_TITLE)
    return c.json({ error: `title must be ${MAX_TITLE} characters or fewer` }, 400)

  const description: string | null =
    typeof body?.description === 'string' ? body.description.trim() || null : null
  if (description && description.length > MAX_DESCRIPTION)
    return c.json({ error: `description must be ${MAX_DESCRIPTION} characters or fewer` }, 400)

  const priority = ['low', 'normal', 'high', 'urgent'].includes(body?.priority)
    ? body.priority
    : 'normal'
  const repeat = ['none', 'daily', 'weekly'].includes(body?.repeat) ? body.repeat : 'none'
  const dueAt = body?.dueAt ? new Date(body.dueAt) : null

  // De-dupe the incoming id lists up front.
  const rawStaffIds: unknown[] = Array.isArray(body?.assignees?.staffIds)
    ? body.assignees.staffIds
    : []
  const rawUserIds: unknown[] = Array.isArray(body?.assignees?.userIds)
    ? body.assignees.userIds
    : []
  const staffIds: string[] = [
    ...new Set(rawStaffIds.filter((x): x is string => typeof x === 'string')),
  ]
  const userIds: string[] = [
    ...new Set(rawUserIds.filter((x): x is string => typeof x === 'string')),
  ]

  if (staffIds.length === 0 && userIds.length === 0) {
    return c.json({ error: 'At least one assignee (staffIds or userIds) is required' }, 400)
  }
  // staff.id is a uuid column — reject malformed ids before the existence query
  // so it can't raise a Postgres cast error (surfacing as a 500).
  if (staffIds.some((id) => !UUID_RE.test(id))) {
    return c.json({ error: 'Invalid staff assignee id' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)

  // Validate that every assignee actually exists, so a stale/nonexistent id
  // returns a clean 400 instead of an FK violation (500) that would otherwise
  // leave an orphaned, assignee-less task behind. Also collect each staff row's
  // linked userId for de-duplication below.
  const staffRows = staffIds.length
    ? await db
        .select({ id: staff.id, userId: staff.userId })
        .from(staff)
        .where(inArray(staff.id, staffIds))
    : []
  if (staffRows.length !== staffIds.length) {
    return c.json({ error: 'One or more staff assignees no longer exist' }, 400)
  }
  if (userIds.length) {
    const userRows = await db.select({ id: user.id }).from(user).where(inArray(user.id, userIds))
    if (userRows.length !== userIds.length) {
      return c.json({ error: 'One or more user assignees no longer exist' }, 400)
    }
  }

  // De-dupe a person assigned both as staff and as a user (e.g. picking your own
  // staff record AND toggling "Assign to me") — keep the staff assignment, drop
  // the redundant user one, so they aren't notified or counted twice.
  const staffLinkedUserIds = new Set(staffRows.map((s) => s.userId).filter((x): x is string => !!x))
  const finalUserIds = userIds.filter((uid) => !staffLinkedUserIds.has(uid))

  // Task + assignments are written in one transaction: if the assignment insert
  // fails for any reason, the task insert rolls back too (no orphan task).
  const { task, assignments } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tasks)
      .values({
        title,
        description,
        priority,
        repeat,
        dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
        createdByUserId: authUser.id,
      })
      .returning()
    const inserted = await tx
      .insert(taskAssignments)
      .values([
        ...staffIds.map((staffId) => ({ taskId: created.id, staffId })),
        ...finalUserIds.map((userId) => ({ taskId: created.id, userId })),
      ])
      .returning({
        id: taskAssignments.id,
        staffId: taskAssignments.staffId,
        userId: taskAssignments.userId,
      })
    return { task: created, assignments: inserted }
  })

  // Notify after the write commits — a notification failure must never fail the
  // create (or the operator retries and duplicates the task).
  await notifyTaskAssignees(db, task, assignments).catch((err) =>
    logError(err, { context: '[tasks] notify on create' })
  )

  return c.json({ success: true, data: { id: task.id, assignments: assignments.length } })
})

// ── GET / — list all tasks with assignment summary (admin) ──────────────────
taskApp.get('/', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const statusFilter = c.req.query('status') // 'open' | 'done' | undefined
  const limit = parseLimit(c.req.query('limit'))
  const offset = parseOffset(c.req.query('offset'))
  const db = getDb(process.env.DATABASE_URL!)

  // `total` is the full task count so the client can page (Load more) and show
  // an accurate count instead of silently capping at the returned page.
  const [{ value: total }] = await db.select({ value: count() }).from(tasks)

  const taskRows = await db
    .select()
    .from(tasks)
    .orderBy(desc(tasks.createdAt))
    .limit(limit)
    .offset(offset)
  if (taskRows.length === 0) return c.json({ success: true, data: [], total })

  const taskIds = taskRows.map((t) => t.id)
  const assignments = await db
    .select({
      id: taskAssignments.id,
      taskId: taskAssignments.taskId,
      staffId: taskAssignments.staffId,
      userId: taskAssignments.userId,
      status: taskAssignments.status,
      doneAt: taskAssignments.doneAt,
      staffName: staff.fullName,
      userName: user.name,
    })
    .from(taskAssignments)
    .leftJoin(staff, eq(taskAssignments.staffId, staff.id))
    .leftJoin(user, eq(taskAssignments.userId, user.id))
    .where(inArray(taskAssignments.taskId, taskIds))

  const byTask = new Map<string, typeof assignments>()
  for (const a of assignments) {
    const list = byTask.get(a.taskId) ?? []
    list.push(a)
    byTask.set(a.taskId, list)
  }

  const data = taskRows
    .map((t) => {
      const list = byTask.get(t.id) ?? []
      const done = list.filter((a) => a.status === 'done').length
      return {
        ...t,
        assigneeCount: list.length,
        doneCount: done,
        assignees: list.map((a) => ({
          id: a.id,
          name: a.staffName ?? a.userName ?? 'Unknown',
          status: a.status,
          doneAt: a.doneAt,
          isSelf: a.userId === authUser.id,
        })),
      }
    })
    .filter((t) => {
      if (statusFilter === 'open') return t.doneCount < t.assigneeCount
      if (statusFilter === 'done') return t.assigneeCount > 0 && t.doneCount === t.assigneeCount
      return true
    })

  return c.json({ success: true, data, total })
})

// ── GET /mine — tasks assigned to the current user (staff or self) ──────────
taskApp.get('/mine', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  const limit = parseLimit(c.req.query('limit'))
  const offset = parseOffset(c.req.query('offset'))
  const db = getDb(process.env.DATABASE_URL!)
  const [me] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.userId, authUser.id))
    .limit(1)

  const conds = [eq(taskAssignments.userId, authUser.id)]
  if (me) conds.push(eq(taskAssignments.staffId, me.id))
  const whereClause = or(...conds)

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(taskAssignments)
    .where(whereClause)

  const rows = await db
    .select({
      assignmentId: taskAssignments.id,
      status: taskAssignments.status,
      doneAt: taskAssignments.doneAt,
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      priority: tasks.priority,
      dueAt: tasks.dueAt,
      createdAt: tasks.createdAt,
    })
    .from(taskAssignments)
    .innerJoin(tasks, eq(taskAssignments.taskId, tasks.id))
    .where(whereClause)
    .orderBy(desc(tasks.createdAt))
    .limit(limit)
    .offset(offset)

  return c.json({ success: true, data: rows, total })
})

// ── PATCH /assignments/:id — mark an assignment done / reopen ───────────────
taskApp.patch('/assignments/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid assignment id' }, 400)
  const body = await c.req.json().catch(() => null)
  const status = body?.status === 'done' ? 'done' : 'pending'

  const db = getDb(process.env.DATABASE_URL!)
  const [assignment] = await db
    .select()
    .from(taskAssignments)
    .where(eq(taskAssignments.id, id))
    .limit(1)
  if (!assignment) return c.json({ error: 'Assignment not found' }, 404)

  // Owner can update their own assignment; otherwise require STAFF:UPDATE.
  const [me] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.userId, authUser.id))
    .limit(1)
  const isOwner = assignment.userId === authUser.id || (me && assignment.staffId === me.id)
  if (!isOwner) {
    if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.UPDATE as string)))
      return c.json({ error: 'Unauthorized' }, 403)
  }

  await db
    .update(taskAssignments)
    .set({ status, doneAt: status === 'done' ? new Date() : null })
    .where(eq(taskAssignments.id, id))

  return c.json({ success: true })
})

// ── PATCH /:id — update task fields (admin) ─────────────────────────────────
taskApp.patch('/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid task id' }, 400)
  const body = await c.req.json().catch(() => null)
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (typeof body?.title === 'string' && body.title.trim()) patch.title = body.title.trim()
  if ('description' in (body ?? {})) patch.description = body.description ?? null
  if (['low', 'normal', 'high', 'urgent'].includes(body?.priority)) patch.priority = body.priority
  if (['none', 'daily', 'weekly'].includes(body?.repeat)) patch.repeat = body.repeat
  if ('dueAt' in (body ?? {})) {
    const d = body.dueAt ? new Date(body.dueAt) : null
    patch.dueAt = d && !Number.isNaN(d.getTime()) ? d : null
  }

  const db = getDb(process.env.DATABASE_URL!)
  const updated = await db
    .update(tasks)
    .set(patch)
    .where(eq(tasks.id, id))
    .returning({ id: tasks.id })
  if (updated.length === 0) return c.json({ error: 'Task not found' }, 404)
  return c.json({ success: true })
})

// ── DELETE /:id — delete a task (admin) ─────────────────────────────────────
taskApp.delete('/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid task id' }, 400)
  const db = getDb(process.env.DATABASE_URL!)
  const deleted = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id }) // assignments cascade
  if (deleted.length === 0) return c.json({ error: 'Task not found' }, 404)
  return c.json({ success: true })
})

export { taskApp }
