/**
 * Phase 2 HR endpoints — org chart, multi-step approvals, lifecycle tasks,
 * compensation history, review cycles, goals, 1:1 notes.
 *
 * Kept separate from the legacy `staff.ts` router to keep that file from
 * growing further. All routes are mounted under `/api/hr/*`.
 */

import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  jobGrades,
  reviewCycleParticipants,
  reviewCycles,
  staff,
  staffCompensationHistory,
  staffGoals,
  staffLifecycleTasks,
  staffOneOnOneNotes,
  staffRequestApprovals,
  staffRequests,
} from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { type LifecycleKind, templateFor } from '../lib/lifecycle-tasks'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { checkLeaveWithinBalance } from './staff-attendance'

const hrPhase2 = new Hono<HonoEnv>()

// ─── Org chart ───────────────────────────────────────────────────────────────

/**
 * GET /api/hr/org-chart
 *
 * Returns the active staff with their direct manager. Frontend builds the
 * tree client-side from the flat list. Soft-deleted and inactive staff
 * are excluded by default.
 */
hrPhase2.get('/org-chart', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const rows = await db
      .select({
        id: staff.id,
        fullName: staff.fullName,
        position: staff.position,
        profileImage: staff.profileImage,
        managerId: staff.managerId,
        staffType: staff.staffType,
      })
      .from(staff)
      .where(and(isNull(staff.deletedAt), eq(staff.status, 'active')))
      .orderBy(staff.fullName)
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: '[hr/org-chart]' })
    return c.json({ error: 'Failed to load org chart' }, 500)
  }
})

/**
 * PATCH /api/hr/staff/:staffId/manager — set or clear the direct manager.
 */
hrPhase2.patch('/staff/:staffId/manager', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const body = (await c.req.json().catch(() => ({}))) as { managerId?: string | null }
  const nextManagerId = body.managerId ?? null

  if (nextManagerId === staffId) {
    return c.json({ error: 'A staff member cannot be their own manager.' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    // Cycle detection — walk up the prospective manager's chain and refuse
    // if we encounter the current staff member.
    if (nextManagerId) {
      let cursor: string | null = nextManagerId
      const visited = new Set<string>()
      while (cursor) {
        if (cursor === staffId) {
          return c.json({ error: 'Refused — this would create a cycle in the org chart.' }, 400)
        }
        if (visited.has(cursor)) break
        visited.add(cursor)
        const rows: Array<{ managerId: string | null }> = await db
          .select({ managerId: staff.managerId })
          .from(staff)
          .where(eq(staff.id, cursor))
          .limit(1)
        cursor = rows[0]?.managerId ?? null
      }
    }

    const existing = await db.query.staff.findFirst({
      where: eq(staff.id, staffId),
      columns: { id: true, fullName: true, managerId: true },
    })
    if (!existing) return c.json({ error: 'Staff not found' }, 404)

    await db
      .update(staff)
      .set({ managerId: nextManagerId, updatedAt: new Date() })
      .where(eq(staff.id, staffId))

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'manager_changed',
      module: 'staff',
      entityId: staffId,
      entityName: existing.fullName,
      beforeJson: { managerId: existing.managerId },
      afterJson: { managerId: nextManagerId },
    })
    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { context: '[hr/manager]' })
    return c.json({ error: 'Failed to update manager' }, 500)
  }
})

// ─── Multi-step approval chains ──────────────────────────────────────────────

/**
 * POST /api/hr/requests/:id/approval-chain
 * Body: { steps: Array<{ stepOrder, approverUserId?, approverRole?, required }> }
 */
hrPhase2.post('/requests/:id/approval-chain', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_REQUESTS as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const requestId = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as {
    steps?: Array<{
      stepOrder: number
      approverUserId?: string | null
      approverRole?: string | null
      required?: boolean
    }>
  }

  const steps = Array.isArray(body.steps) ? body.steps : []
  if (steps.length === 0) {
    return c.json({ error: 'At least one approval step is required.' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    await db.transaction(async (tx) => {
      // Replace any existing chain
      await tx.delete(staffRequestApprovals).where(eq(staffRequestApprovals.requestId, requestId))
      await tx.insert(staffRequestApprovals).values(
        steps.map((s) => ({
          requestId,
          stepOrder: s.stepOrder,
          approverUserId: s.approverUserId ?? null,
          approverRole: s.approverRole ?? null,
          required: s.required ?? true,
        }))
      )
    })

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'approval_chain_set',
      module: 'staff_requests',
      entityId: requestId,
      changes: { steps: steps.length },
    })

    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { context: '[hr/approval-chain]' })
    return c.json({ error: 'Failed to set approval chain' }, 500)
  }
})

/**
 * PATCH /api/hr/approvals/:approvalId — approver decides their step.
 * Body: { status: 'approved' | 'rejected', comments?: string }
 *
 * When the final required step is approved, the parent staff_requests row
 * is auto-promoted to 'approved'. A rejection at any required step
 * propagates to the parent.
 */
hrPhase2.patch('/approvals/:approvalId', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_REQUESTS as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const approvalId = c.req.param('approvalId')
  const body = (await c.req.json().catch(() => ({}))) as {
    status?: 'approved' | 'rejected'
    comments?: string
  }
  if (body.status !== 'approved' && body.status !== 'rejected') {
    return c.json({ error: "status must be 'approved' or 'rejected'" }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const approval = await db.query.staffRequestApprovals.findFirst({
      where: eq(staffRequestApprovals.id, approvalId),
    })
    if (!approval) return c.json({ error: 'Approval step not found' }, 404)

    // Approver-authorization guard.
    // - If a specific approverUserId is set, only that user (or an admin) may decide.
    // - HR-H7: if the step is ROLE-keyed (approverRole set, no approverUserId — a
    //   first-class config), only a user whose role matches (or an admin) may
    //   decide. This role branch was previously missing, so any holder of the
    //   coarse STAFF_REQUESTS:update could decide a step intended for another role.
    const isAdmin = authUser.roleId === 'admin'
    if (approval.approverUserId) {
      if (approval.approverUserId !== authUser.id && !isAdmin) {
        return c.json({ error: 'You are not the assigned approver for this step.' }, 403)
      }
    } else if (approval.approverRole) {
      if (authUser.roleId !== approval.approverRole && !isAdmin) {
        return c.json({ error: 'Your role is not authorized to decide this approval step.' }, 403)
      }
    }

    if (approval.status !== 'pending') {
      return c.json(
        { error: `Approval already ${approval.status} — chain is immutable after decision.` },
        409
      )
    }

    // HR-H6: enforce the annual-leave entitlement on the multi-step chain too —
    // the single-step review (staff-core) already does this via the SAME shared
    // helper. Without it, a leave routed through an approval chain could be
    // approved past entitlement. Refuse BEFORE recording the step decision so
    // nothing is half-written.
    if (body.status === 'approved') {
      const leaveCheck = await checkLeaveWithinBalance(db, approval.requestId)
      if (!leaveCheck.ok) {
        const { requested, remaining, entitlement } = leaveCheck
        return c.json(
          {
            error: `Approving would use ${requested} day${requested === 1 ? '' : 's'}, but only ${remaining} remain (entitlement: ${entitlement}).`,
            code: 'LEAVE_BALANCE_EXCEEDED',
            data: { requested, remaining, entitlement },
          },
          409
        )
      }
    }

    const now = new Date()
    await db
      .update(staffRequestApprovals)
      .set({
        status: body.status,
        comments: body.comments ?? null,
        decidedAt: now,
        decidedById: authUser.id,
        updatedAt: now,
      })
      .where(eq(staffRequestApprovals.id, approvalId))

    // Re-check the chain to update the parent request status.
    const allSteps = await db
      .select()
      .from(staffRequestApprovals)
      .where(eq(staffRequestApprovals.requestId, approval.requestId))
      .orderBy(asc(staffRequestApprovals.stepOrder))

    const anyRejected = allSteps.some((s) => s.required && s.status === 'rejected')
    const allDecided = allSteps.every(
      (s) => !s.required || s.status === 'approved' || s.status === 'skipped'
    )
    const stillPending = allSteps.some((s) => s.required && s.status === 'pending')

    let parentStatus: 'approved' | 'rejected' | null = null
    if (anyRejected) parentStatus = 'rejected'
    else if (allDecided && !stillPending) parentStatus = 'approved'

    if (parentStatus) {
      await db
        .update(staffRequests)
        .set({
          status: parentStatus,
          reviewedById: authUser.id,
          reviewedAt: now,
        })
        .where(eq(staffRequests.id, approval.requestId))
    }

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: `approval_step_${body.status}`,
      module: 'staff_requests',
      entityId: approval.requestId,
      changes: { approvalId, status: body.status, comments: body.comments ?? null },
    })

    return c.json({ success: true, data: { parentStatus } })
  } catch (error: unknown) {
    logError(error, { context: '[hr/approval-decision]' })
    return c.json({ error: 'Failed to record approval decision' }, 500)
  }
})

// ─── Lifecycle tasks ─────────────────────────────────────────────────────────

/**
 * POST /api/hr/staff/:staffId/lifecycle/:kind — instantiate a lifecycle
 * checklist from the matching template. Idempotent for `onboarding` /
 * `offboarding` — skips tasks whose taskKey already exists for that kind.
 */
hrPhase2.post('/staff/:staffId/lifecycle/:kind', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const kind = c.req.param('kind') as LifecycleKind
  const template = templateFor(kind)
  if (template.length === 0) {
    return c.json({ error: `Unknown lifecycle kind: ${kind}` }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const existing = await db
      .select({ taskKey: staffLifecycleTasks.taskKey })
      .from(staffLifecycleTasks)
      .where(and(eq(staffLifecycleTasks.staffId, staffId), eq(staffLifecycleTasks.kind, kind)))
    const existingKeys = new Set(existing.map((r) => r.taskKey))

    const now = new Date()
    const toInsert = template
      .filter((t) => !existingKeys.has(t.key))
      .map((t) => ({
        staffId,
        kind,
        taskKey: t.key,
        label: t.label,
        description: t.description ?? null,
        dueAt: t.defaultDueDays
          ? new Date(now.getTime() + t.defaultDueDays * 24 * 60 * 60 * 1000)
          : null,
      }))

    if (toInsert.length > 0) {
      await db.insert(staffLifecycleTasks).values(toInsert)
    }

    return c.json({
      success: true,
      data: { inserted: toInsert.length, skipped: existing.length },
    })
  } catch (error: unknown) {
    logError(error, { context: '[hr/lifecycle]' })
    return c.json({ error: 'Failed to instantiate lifecycle tasks' }, 500)
  }
})

/**
 * GET /api/hr/staff/:staffId/lifecycle — list all lifecycle tasks for a staff member.
 */
hrPhase2.get('/staff/:staffId/lifecycle', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db
      .select()
      .from(staffLifecycleTasks)
      .where(eq(staffLifecycleTasks.staffId, staffId))
      .orderBy(staffLifecycleTasks.kind, staffLifecycleTasks.createdAt)
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: '[hr/lifecycle GET]' })
    return c.json({ error: 'Failed to fetch lifecycle tasks' }, 500)
  }
})

/**
 * PATCH /api/hr/lifecycle/:taskId — mark task complete, in_progress, skipped.
 */
hrPhase2.patch('/lifecycle/:taskId', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const taskId = c.req.param('taskId')
  const body = (await c.req.json().catch(() => ({}))) as {
    status?: 'pending' | 'in_progress' | 'completed' | 'skipped'
    notes?: string
    assigneeUserId?: string | null
    dueAt?: string | null
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const existing = await db.query.staffLifecycleTasks.findFirst({
      where: eq(staffLifecycleTasks.id, taskId),
    })
    if (!existing) return c.json({ error: 'Task not found' }, 404)

    const now = new Date()
    const update: Record<string, unknown> = { updatedAt: now }
    if (body.status) {
      update.status = body.status
      if (body.status === 'completed') {
        update.completedAt = now
        update.completedById = authUser.id
      } else if (body.status === 'pending' || body.status === 'in_progress') {
        update.completedAt = null
        update.completedById = null
      }
    }
    if (body.notes !== undefined) update.notes = body.notes
    if (body.assigneeUserId !== undefined) update.assigneeUserId = body.assigneeUserId
    if (body.dueAt !== undefined) update.dueAt = body.dueAt ? new Date(body.dueAt) : null

    await db.update(staffLifecycleTasks).set(update).where(eq(staffLifecycleTasks.id, taskId))
    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { context: '[hr/lifecycle PATCH]' })
    return c.json({ error: 'Failed to update lifecycle task' }, 500)
  }
})

// ─── Compensation history + job grades (Phase 2C) ────────────────────────────

hrPhase2.get('/job-grades', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.select().from(jobGrades).orderBy(jobGrades.name)
  return c.json({ success: true, data: rows })
})

hrPhase2.post('/job-grades', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = await c.req.json().catch(() => ({}))
  if (!body.name) return c.json({ error: 'name is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(jobGrades)
    .values({
      name: body.name,
      description: body.description ?? null,
      minSalary: body.minSalary ?? null,
      maxSalary: body.maxSalary ?? null,
      currency: body.currency ?? 'GHS',
    })
    .returning()
  return c.json({ success: true, data: row })
})

hrPhase2.get('/staff/:staffId/compensation', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(staffCompensationHistory)
    .where(eq(staffCompensationHistory.staffId, staffId))
    .orderBy(desc(staffCompensationHistory.effectiveFrom))
  return c.json({ success: true, data: rows })
})

hrPhase2.post('/staff/:staffId/compensation', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  // HR-L9: recording base salary is a payroll-grade action — gate on
  // payroll:update, not the generic staff:update (which the FE CompensationTab
  // now mirrors).
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const body = (await c.req.json().catch(() => ({}))) as {
    baseAmount?: number
    effectiveFrom?: string
    currency?: string
    jobGradeId?: string | null
    reason?: string
    notes?: string
  }
  if (!body.baseAmount || !body.effectiveFrom) {
    return c.json({ error: 'baseAmount and effectiveFrom are required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const effectiveFrom = new Date(body.effectiveFrom)

  await db.transaction(async (tx) => {
    // Close any open-ended prior row.
    await tx
      .update(staffCompensationHistory)
      .set({ effectiveTo: effectiveFrom })
      .where(
        and(
          eq(staffCompensationHistory.staffId, staffId),
          isNull(staffCompensationHistory.effectiveTo)
        )
      )

    await tx.insert(staffCompensationHistory).values({
      staffId,
      effectiveFrom,
      baseAmount: body.baseAmount ?? 0,
      currency: body.currency ?? 'GHS',
      jobGradeId: body.jobGradeId ?? null,
      reason: body.reason ?? null,
      notes: body.notes ?? null,
      createdById: authUser.id,
    })
  })

  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'compensation_recorded',
    module: 'staff',
    entityId: staffId,
    changes: {
      baseAmount: body.baseAmount,
      effectiveFrom: body.effectiveFrom,
      reason: body.reason,
    },
  })

  return c.json({ success: true })
})

// ─── Review cycles + goals + 1:1 notes (Phase 2D) ────────────────────────────

hrPhase2.get('/review-cycles', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.select().from(reviewCycles).orderBy(desc(reviewCycles.startDate))
  return c.json({ success: true, data: rows })
})

hrPhase2.post('/review-cycles', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.CREATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string
    cycleType?: string
    startDate?: string
    endDate?: string
    participantStaffIds?: string[]
  }
  if (!body.name || !body.startDate || !body.endDate) {
    return c.json({ error: 'name, startDate, endDate are required' }, 400)
  }
  const start = new Date(body.startDate)
  const end = new Date(body.endDate)
  if (end <= start) return c.json({ error: 'endDate must be after startDate' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const [cycle] = await db
    .insert(reviewCycles)
    .values({
      name: body.name,
      cycleType: body.cycleType ?? 'quarterly',
      startDate: start,
      endDate: end,
      status: 'draft',
      createdById: authUser.id,
    })
    .returning()

  if (body.participantStaffIds?.length) {
    await db.insert(reviewCycleParticipants).values(
      body.participantStaffIds.map((sid) => ({
        cycleId: cycle.id,
        staffId: sid,
      }))
    )
  }

  return c.json({ success: true, data: cycle })
})

hrPhase2.patch('/review-cycles/:cycleId/status', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const cycleId = c.req.param('cycleId')
  const body = (await c.req.json().catch(() => ({}))) as { status?: 'draft' | 'active' | 'closed' }
  if (!body.status || !['draft', 'active', 'closed'].includes(body.status)) {
    return c.json({ error: "status must be 'draft' | 'active' | 'closed'" }, 400)
  }
  const db = getDb(process.env.DATABASE_URL!)
  await db
    .update(reviewCycles)
    .set({ status: body.status, updatedAt: new Date() })
    .where(eq(reviewCycles.id, cycleId))
  return c.json({ success: true })
})

hrPhase2.get('/staff/:staffId/goals', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(staffGoals)
    .where(eq(staffGoals.staffId, staffId))
    .orderBy(desc(staffGoals.createdAt))
  return c.json({ success: true, data: rows })
})

hrPhase2.post('/staff/:staffId/goals', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.CREATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string
    description?: string
    category?: string
    targetDate?: string
    cycleId?: string | null
  }
  if (!body.title) return c.json({ error: 'title is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(staffGoals)
    .values({
      staffId,
      title: body.title,
      description: body.description ?? null,
      category: body.category ?? null,
      targetDate: body.targetDate ? new Date(body.targetDate) : null,
      cycleId: body.cycleId ?? null,
      createdById: authUser.id,
    })
    .returning()
  return c.json({ success: true, data: row })
})

hrPhase2.patch('/goals/:goalId', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const goalId = c.req.param('goalId')
  const body = await c.req.json().catch(() => ({}))
  const update: Record<string, unknown> = { updatedAt: new Date() }
  if (body.title !== undefined) update.title = body.title
  if (body.description !== undefined) update.description = body.description
  if (body.status !== undefined) update.status = body.status
  if (body.progressPercent !== undefined)
    update.progressPercent = Math.max(0, Math.min(100, Number(body.progressPercent)))
  if (body.outcomeNotes !== undefined) update.outcomeNotes = body.outcomeNotes
  if (body.targetDate !== undefined)
    update.targetDate = body.targetDate ? new Date(body.targetDate) : null

  const db = getDb(process.env.DATABASE_URL!)
  await db.update(staffGoals).set(update).where(eq(staffGoals.id, goalId))
  return c.json({ success: true })
})

hrPhase2.get('/staff/:staffId/one-on-ones', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const db = getDb(process.env.DATABASE_URL!)
  // Filter out private notes the current user didn't author.
  const rows = await db
    .select()
    .from(staffOneOnOneNotes)
    .where(eq(staffOneOnOneNotes.staffId, staffId))
    .orderBy(desc(staffOneOnOneNotes.meetingDate))
  const visible = rows.filter(
    (r) => !r.privateNote || r.managerUserId === authUser.id || authUser.roleId === 'admin'
  )
  return c.json({ success: true, data: visible })
})

hrPhase2.post('/staff/:staffId/one-on-ones', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.CREATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const body = (await c.req.json().catch(() => ({}))) as {
    meetingDate?: string
    agenda?: string
    notes?: string
    actionItems?: Array<{ description: string; owner?: string; dueAt?: string; done?: boolean }>
    privateNote?: boolean
  }
  if (!body.meetingDate) return c.json({ error: 'meetingDate is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(staffOneOnOneNotes)
    .values({
      staffId,
      managerUserId: authUser.id,
      meetingDate: new Date(body.meetingDate),
      agenda: body.agenda ?? null,
      notes: body.notes ?? null,
      actionItems: body.actionItems ?? [],
      privateNote: body.privateNote ?? false,
    })
    .returning()
  return c.json({ success: true, data: row })
})

// ─── HR dashboard widget — lifecycle blockers ────────────────────────────────
//
// Returns onboarding/offboarding tasks currently in flight so the HR
// dashboard can show "what's blocking onboarding for new hires".

hrPhase2.get('/lifecycle/active', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const now = new Date()

  const rows = await db
    .select({
      id: staffLifecycleTasks.id,
      staffId: staffLifecycleTasks.staffId,
      kind: staffLifecycleTasks.kind,
      taskKey: staffLifecycleTasks.taskKey,
      label: staffLifecycleTasks.label,
      status: staffLifecycleTasks.status,
      dueAt: staffLifecycleTasks.dueAt,
      staffName: staff.fullName,
    })
    .from(staffLifecycleTasks)
    .innerJoin(staff, eq(staff.id, staffLifecycleTasks.staffId))
    .where(
      and(isNull(staff.deletedAt), sql`${staffLifecycleTasks.status} IN ('pending', 'in_progress')`)
    )
    .orderBy(asc(staffLifecycleTasks.dueAt))
    .limit(50)

  // Highlight overdue rows so the dashboard can flag them.
  const enriched = rows.map((r) => ({
    ...r,
    overdue: !!(r.dueAt && r.dueAt < now),
  }))
  return c.json({ success: true, data: enriched })
})

// Suppress unused-imports lint on helpers we'll reach for in follow-ups.
void gte
void lte

export { hrPhase2 }
