import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  staff,
  staffTrainingProgress,
  trainingAttempts,
  trainingMaterials,
  user,
} from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { sanitizeTrainingBlocks } from '../lib/html-sanitize'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import {
  bulkAssignTraining,
  deriveTrainingStatus,
  reopenExpiredTraining,
} from '../lib/training-renewal'
import type { HonoEnv } from '../lib/types'

// admin-v1 §15.1 — parse an optional ISO due date from a request body.
// Returns: a Date when valid, `null` when explicitly cleared (null), or
// `undefined` when the field was omitted (leave as-is). Throws on garbage.
function parseDueDate(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  const d = new Date(raw as string)
  if (Number.isNaN(d.getTime())) throw new Error('invalid dueDate')
  return d
}

// admin-v1 §15.1 — validate an optional renewal interval (months). null/omitted
// → one-off. Throws on a non-positive / non-integer / absurd value.
function parseRenewalMonths(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 600) {
    throw new Error('renewalMonths must be a positive integer (months), max 600')
  }
  return n
}

const app = new Hono<HonoEnv>()

const MODULE = MODULES.STAFF

// ---------------------------------------------------------------------------
// Training Materials (Admin upload/manage)
// ---------------------------------------------------------------------------

/** List all training materials */
app.get('/training/all', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_TRAINING as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10)
  const offsetParam = Number.parseInt(c.req.query('offset') ?? '', 10)
  const paginated = Number.isFinite(limitParam) && limitParam > 0
  const limit = paginated ? Math.min(Math.max(limitParam, 1), 100) : 200
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0

  try {
    // PR-32 — was eager-loading the full staff row for every progress row
    // (`progress: { with: { staff: true } }`). The PWA + portal consumers
    // only need `.progress.length` for the learner-count badge; the full
    // staff details aren't read on the list page. Drop the join.
    const data = await db.query.trainingMaterials.findMany({
      with: { progress: true },
      orderBy: [desc(trainingMaterials.createdAt)],
      limit,
      offset,
    })
    return c.json({
      success: true,
      data,
      pagination: { limit, offset, returned: data.length },
    })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch training materials' }, 500)
  }
})

// PR-30 — numeric range guards for training material columns.
//
// These columns flow into the runtime quiz engine (passingScore feeds the
// score>=threshold comparison; quizTimer drives the deadline check). A
// stray Infinity / NaN / negative silently breaks the comparison and the
// quiz becomes unpassable — or unreviewable. Validate at the write
// boundary so the column always holds something usable.
function validateTrainingNumerics(body: any): string | null {
  if (body.passingScore !== undefined && body.passingScore !== null) {
    const n = Number(body.passingScore)
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return 'passingScore must be a finite number between 0 and 100'
    }
  }
  if (body.quizTimer !== undefined && body.quizTimer !== null) {
    const n = Number(body.quizTimer)
    if (!Number.isFinite(n) || n <= 0 || n > 24 * 60) {
      return 'quizTimer must be a finite number of minutes between 1 and 1440'
    }
  }
  return null
}

/** Create training material */
app.post('/training', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_TRAINING as string,
      ACTIONS.CREATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    const numericErr = validateTrainingNumerics(body)
    if (numericErr) return c.json({ error: numericErr }, 400)

    const [material] = await db
      .insert(trainingMaterials)
      .values({
        title: body.title,
        description: body.description,
        materialType: body.materialType || 'module',
        contentUrl: body.contentUrl,
        externalUrl: body.externalUrl,
        isMandatory: body.isMandatory ?? false,
        allowReassessment: body.allowReassessment ?? false,
        deadline: body.deadline ? new Date(body.deadline) : null,
        passingScore: body.passingScore,
        assignedTo: body.assignedTo || [],
        uploadedById: authUser.id,
        blocks: sanitizeTrainingBlocks(body.blocks || []) as any,
        quizTimer: body.quizTimer || null,
        quizQuestions: body.quizQuestions || [],
        published: body.published ?? false,
        publishedAt: body.published ? new Date() : null,
        audience: body.audience || 'All Staff',
        level: body.level || 'info',
      })
      .returning()

    // Auto-create progress records for assigned staff
    const assignedStaffIds: string[] = body.assignedTo || []
    if (assignedStaffIds.length > 0 && !assignedStaffIds.includes('all')) {
      const progressRecords = assignedStaffIds.map((sId: string) => ({
        staffId: sId,
        trainingId: material.id,
      }))
      await db.insert(staffTrainingProgress).values(progressRecords)
    } else if (assignedStaffIds.includes('all')) {
      // Assign to all active staff
      const allStaff = await db.query.staff.findMany({
        where: eq(staff.status, 'active'),
      })
      if (allStaff.length > 0) {
        const progressRecords = allStaff.map((s) => ({
          staffId: s.id,
          trainingId: material.id,
        }))
        await db.insert(staffTrainingProgress).values(progressRecords)
      }
    }

    return c.json({ success: true, data: material })
  } catch (error: unknown) {
    logError(error, { context: '[staff] Training create error' })
    return c.json({ error: 'Failed to create training material' }, 500)
  }
})

/**
 * PR-39 — Add specific staff to a training material's assignment list.
 *
 * Body: { staffIds: string[] }
 *
 * Idempotent: staff already in `assignedTo` are skipped. Auto-creates
 * staff_training_progress rows for the newly added staff so the module
 * appears in their PWA on next fetch. Gated on STAFF_TRAINING.UPDATE.
 */
app.post('/training/:id/assign-staff', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_TRAINING as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const trainingId = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as {
    staffIds?: unknown
    dueDate?: unknown
    renewalMonths?: unknown
  }
  const rawIds = Array.isArray(body.staffIds) ? body.staffIds : []
  const incoming = rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (incoming.length === 0) {
    return c.json({ error: 'staffIds array required' }, 400)
  }

  // admin-v1 §15.1 — optional scheduling on the new assignments.
  let dueDate: Date | null | undefined
  let renewalMonths: number | null | undefined
  try {
    dueDate = parseDueDate(body.dueDate)
    renewalMonths = parseRenewalMonths(body.renewalMonths)
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'invalid scheduling input' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const material = await db.query.trainingMaterials.findFirst({
    where: eq(trainingMaterials.id, trainingId),
  })
  if (!material) return c.json({ error: 'Training material not found' }, 404)

  const current = Array.isArray(material.assignedTo) ? (material.assignedTo as string[]) : []
  // If the material is already broadcast to everyone, the assignment is
  // a no-op for our purposes — the staff are already covered. Surface
  // that back to the caller instead of silently doing nothing.
  if (current.includes('all')) {
    return c.json({
      success: true,
      data: { added: 0, alreadyBroadcast: true, total: current.length },
    })
  }

  const dedup = new Set(current)
  const newly: string[] = []
  for (const id of incoming) {
    if (!dedup.has(id)) {
      dedup.add(id)
      newly.push(id)
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(trainingMaterials)
      .set({ assignedTo: Array.from(dedup) as any, updatedAt: new Date() })
      .where(eq(trainingMaterials.id, trainingId))
    if (newly.length > 0) {
      // Only create progress rows for the actual new staff. onConflictDoNothing
      // would also work via the PR-32 unique index, but filtering keeps the
      // query smaller and the audit trail clearer.
      await tx
        .insert(staffTrainingProgress)
        .values(
          newly.map((sId) => ({
            staffId: sId,
            trainingId,
            // §15.1 — carry the optional schedule onto the new assignments only
            // (undefined columns fall back to the DB default / null).
            ...(dueDate !== undefined ? { dueDate } : {}),
            ...(renewalMonths !== undefined ? { renewalMonths } : {}),
          }))
        )
        .onConflictDoNothing()
    }
  })

  await createAuditLog(db, {
    userId: authUser.id,
    action: 'training_assigned',
    module: 'staff_training',
    entityId: trainingId,
    entityName: material.title,
    changes: { addedStaffIds: newly, totalAssigned: dedup.size },
  })

  return c.json({ success: true, data: { added: newly.length, total: dedup.size } })
})

/**
 * admin-v1 §15.2 — role bulk assignment.
 *
 * Assign a training material to every ACTIVE staff member in a given role
 * in one shot, fanning out `staff_training_progress` rows.
 * Idempotent: staff who already have a row for this material are skipped.
 *
 * Body: { role?: string, dueDate?: ISO, renewalMonths?: int }
 * A role is required. Gated on STAFF_TRAINING.UPDATE.
 */
app.post('/training/:id/bulk-assign', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_TRAINING as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const trainingId = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as {
    role?: unknown
    dueDate?: unknown
    renewalMonths?: unknown
  }

  const role = typeof body.role === 'string' && body.role.trim() ? body.role.trim() : null
  if (!role) {
    return c.json({ error: 'role is required' }, 400)
  }

  let dueDate: Date | null | undefined
  let renewalMonths: number | null | undefined
  try {
    dueDate = parseDueDate(body.dueDate)
    renewalMonths = parseRenewalMonths(body.renewalMonths)
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'invalid scheduling input' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const result = await bulkAssignTraining(db, trainingId, {
      role,
      dueDate: dueDate ?? null,
      renewalMonths: renewalMonths ?? null,
    })

    await createAuditLog(db, {
      userId: authUser.id,
      action: 'training_bulk_assigned',
      module: 'staff_training',
      entityId: trainingId,
      entityName: role ?? '',
      changes: {
        role,
        matched: result.matched,
        assigned: result.assigned,
        skipped: result.skipped,
      },
    })

    return c.json({ success: true, data: result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to bulk assign training'
    if (msg === 'Training material not found') return c.json({ error: msg }, 404)
    if (msg.includes('requires a role')) return c.json({ error: msg }, 400)
    logError(e, { context: '[staff] Training bulk-assign error' })
    return c.json({ error: 'Failed to bulk assign training' }, 500)
  }
})

/**
 * admin-v1 §15.1 — re-open expired recurring training (scheduler/cron trigger).
 *
 * Backfills missing `expiresAt` on completed recurring assignments, then
 * re-opens any whose `expiresAt` has passed (status → not_started, completion
 * cleared, dueDate rolled forward). Safe to call repeatedly. Gated on
 * STAFF_TRAINING.UPDATE — the cron path calls `reopenExpiredTraining` directly.
 */
app.post('/training/reopen-expired', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_TRAINING as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const result = await reopenExpiredTraining(db)
    if (result.reopened > 0 || result.backfilled > 0) {
      await createAuditLog(db, {
        userId: authUser.id,
        action: 'training_reopen_expired',
        module: 'staff_training',
        entityId: 'scheduler',
        entityName: 'recurring training renewal',
        changes: result,
      })
    }
    return c.json({ success: true, data: result })
  } catch (e) {
    logError(e, { context: '[staff] Training reopen-expired error' })
    return c.json({ error: 'Failed to recompute training renewals' }, 500)
  }
})

/** Update training material */
app.patch('/training/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_TRAINING as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    const numericErr = validateTrainingNumerics(body)
    if (numericErr) return c.json({ error: numericErr }, 400)

    const patch: Record<string, any> = { updatedAt: new Date() }
    if (body.title !== undefined) patch.title = body.title
    if (body.description !== undefined) patch.description = body.description
    if (body.materialType !== undefined) patch.materialType = body.materialType
    if (body.contentUrl !== undefined) patch.contentUrl = body.contentUrl
    if (body.externalUrl !== undefined) patch.externalUrl = body.externalUrl
    if (body.isMandatory !== undefined) patch.isMandatory = body.isMandatory
    if (body.allowReassessment !== undefined) patch.allowReassessment = body.allowReassessment
    if (body.deadline !== undefined) patch.deadline = body.deadline ? new Date(body.deadline) : null
    if (body.passingScore !== undefined) patch.passingScore = body.passingScore
    if (body.assignedTo !== undefined) patch.assignedTo = body.assignedTo
    if (body.blocks !== undefined) patch.blocks = sanitizeTrainingBlocks(body.blocks)
    if (body.quizTimer !== undefined) patch.quizTimer = body.quizTimer
    if (body.quizQuestions !== undefined) patch.quizQuestions = body.quizQuestions
    if (body.published !== undefined) {
      patch.published = body.published
      patch.publishedAt = body.published ? new Date(body.publishedAt || Date.now()) : null
    }
    if (body.audience !== undefined) patch.audience = body.audience
    if (body.level !== undefined) patch.level = body.level

    const [updated] = await db
      .update(trainingMaterials)
      .set(patch)
      .where(eq(trainingMaterials.id, id))
      .returning()

    if (!updated) return c.json({ error: 'Training material not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: '[staff] Training update error' })
    return c.json({ error: 'Failed to update training material' }, 500)
  }
})

/** Delete training material */
app.delete('/training/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_TRAINING as string,
      ACTIONS.DELETE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    // PR-30 — capture the deleted row so the audit log preserves what was
    // removed. Training materials feed compliance reports; an unlogged
    // delete makes "why is this completion record gone?" undebuggable.
    const [removed] = await db
      .delete(trainingMaterials)
      .where(eq(trainingMaterials.id, id))
      .returning()
    if (!removed) return c.json({ error: 'Training material not found' }, 404)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'training_material_deleted',
      module: 'staff_training',
      entityId: removed.id,
      entityName: removed.title,
      changes: {
        materialType: removed.materialType,
        isMandatory: removed.isMandatory,
        deadline: removed.deadline,
        published: removed.published,
        questionCount: Array.isArray(removed.quizQuestions) ? removed.quizQuestions.length : 0,
      },
    })
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to delete training material' }, 500)
  }
})

/**
 * PR-42 — admin learners view for /training/learners (portal).
 *
 * Returns all active non-trainer staff + their training progress across
 * EVERY published training material, not just one trainer's. Gated on
 * STAFF.UPDATE (HR admins). The trainer self-service variant
 * (`/training/learners`, no trainerStaffId param) still exists for the
 * PWA trainer module.
 */
app.get('/training/learners-admin', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const now = new Date()

    // Only PUBLISHED materials count toward "assigned" — drafts are not
    // exposed to learners yet.
    const allMaterials = await db
      .select({
        id: trainingMaterials.id,
        title: trainingMaterials.title,
        materialType: trainingMaterials.materialType,
        assignedTo: trainingMaterials.assignedTo,
      })
      .from(trainingMaterials)
      .where(eq(trainingMaterials.published, true))

    const moduleIds = allMaterials.map((m) => m.id)
    const learners = await db
      .select({
        id: staff.id,
        name: staff.fullName,
        email: staff.email,
        role: user.role,
      })
      .from(staff)
      .leftJoin(user, eq(user.id, staff.userId))
      .where(
        and(eq(staff.status, 'active'), eq(staff.isExternalTrainer, false), isNull(staff.deletedAt))
      )

    const progressRows =
      moduleIds.length === 0
        ? []
        : await db
            .select()
            .from(staffTrainingProgress)
            .where(inArray(staffTrainingProgress.trainingId, moduleIds))

    // Dedup (staffId, trainingId) at query time — the DB-level unique
    // constraint (migration 0065) hasn't been applied to every environment,
    // so pre-existing duplicate rows can sneak in. Pick the "best" row per
    // pair: completed beats in_progress beats not_started, then highest
    // progressPercent. Without this, the React list keys collide.
    const statusRank = (s: string) =>
      s === 'completed' ? 3 : s === 'in_progress' ? 2 : s === 'failed' ? 1 : 0
    const progressByStaff = new Map<string, Map<string, (typeof progressRows)[number]>>()
    for (const row of progressRows) {
      const bucket = progressByStaff.get(row.staffId) ?? new Map()
      const existing = bucket.get(row.trainingId)
      if (
        !existing ||
        statusRank(row.status) > statusRank(existing.status) ||
        (statusRank(row.status) === statusRank(existing.status) &&
          (row.progressPercent ?? 0) > (existing.progressPercent ?? 0))
      ) {
        bucket.set(row.trainingId, row)
      }
      progressByStaff.set(row.staffId, bucket)
    }

    // A material counts as assigned to a learner when any of:
    //   - assignedTo includes 'all' (broadcast)
    //   - assignedTo includes the learner's staff id
    // Progress rows then layer their status on top; learners without a row
    // for an assigned material show as "not_started".
    const isAssigned = (mat: (typeof allMaterials)[number], learner: (typeof learners)[number]) => {
      const assignedTo = Array.isArray(mat.assignedTo) ? (mat.assignedTo as string[]) : []
      if (assignedTo.includes('all')) return true
      if (assignedTo.includes(learner.id)) return true
      return false
    }

    const data = learners.map((l) => {
      const progressMap = progressByStaff.get(l.id) ?? new Map()
      const progressByModule = allMaterials
        .filter((m) => isAssigned(m, l) || progressMap.has(m.id))
        .map((m) => {
          const p = progressMap.get(m.id)
          const status = p?.status ?? 'not_started'
          return {
            trainingId: m.id,
            title: m.title,
            materialType: m.materialType,
            status,
            // §15.1 — read-time due/overdue/expired view on top of the stored status.
            derivedStatus: deriveTrainingStatus(
              { status, dueDate: p?.dueDate ?? null, expiresAt: p?.expiresAt ?? null },
              now
            ),
            dueDate: p?.dueDate ?? null,
            expiresAt: p?.expiresAt ?? null,
            renewalMonths: p?.renewalMonths ?? null,
            progressPercent: p?.progressPercent ?? 0,
            score: p?.score ?? null,
            completedAt: p?.completedAt ?? null,
          }
        })
      return { ...l, progressByModule }
    })

    return c.json({ success: true, data })
  } catch (err) {
    logError(err, { context: '[GET /training/learners-admin]' })
    const detail = err instanceof Error ? err.message : String(err)
    return c.json({ error: `learners-admin failed: ${detail}` }, 500)
  }
})

app.get('/training/trainers/:trainerStaffId{[0-9a-fA-F-]{36}}/learners', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const trainerStaffId = c.req.param('trainerStaffId')
  const db = getDb(process.env.DATABASE_URL!)

  // Resolve the trainer's auth user id — trainingMaterials.uploadedById
  // references user.id, not staff.id.
  const [trainerRow] = await db
    .select({ id: staff.id, userId: staff.userId, fullName: staff.fullName })
    .from(staff)
    .where(eq(staff.id, trainerStaffId))
    .limit(1)
  if (!trainerRow) return c.json({ error: 'Trainer not found' }, 404)
  if (!trainerRow.userId)
    return c.json({ success: true, data: { trainer: trainerRow, learners: [] } })

  const trainerModules = await db
    .select({ id: trainingMaterials.id, title: trainingMaterials.title })
    .from(trainingMaterials)
    .where(eq(trainingMaterials.uploadedById, trainerRow.userId))
  const moduleIds = trainerModules.map((m) => m.id)
  if (moduleIds.length === 0) {
    return c.json({ success: true, data: { trainer: trainerRow, learners: [] } })
  }

  const learners = await db
    .select({ id: staff.id, name: staff.fullName, email: staff.email, role: user.role })
    .from(staff)
    .leftJoin(user, eq(user.id, staff.userId))
    .where(and(eq(staff.status, 'active'), eq(staff.isExternalTrainer, false)))

  const progressRows = await db
    .select()
    .from(staffTrainingProgress)
    .where(inArray(staffTrainingProgress.trainingId, moduleIds))

  const moduleMap = new Map(trainerModules.map((m) => [m.id, m.title]))
  const progressByStaff = new Map<string, typeof progressRows>()
  for (const row of progressRows) {
    const bucket = progressByStaff.get(row.staffId) ?? []
    bucket.push(row)
    progressByStaff.set(row.staffId, bucket)
  }

  const data = learners
    .map((l) => {
      const rows = progressByStaff.get(l.id) ?? []
      const progressByModule = rows.map((p) => ({
        trainingId: p.trainingId,
        title: moduleMap.get(p.trainingId) ?? p.trainingId,
        status: p.status,
        progressPercent: p.progressPercent ?? 0,
        score: p.score,
        completedAt: p.completedAt,
      }))
      return { ...l, progressByModule }
    })
    // Only surface learners who actually have progress on this trainer's
    // modules — otherwise HR sees the whole staff roster against the
    // trainer's row, which is misleading.
    .filter((l) => l.progressByModule.length > 0)

  return c.json({ success: true, data: { trainer: trainerRow, learners: data } })
})

/** Get learners with progress on the requesting trainer's modules */
app.get('/training/learners', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_TRAINING as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)

    // PR-46 lifted the per-uploader scope on the materials endpoints — the
    // trainer cohort shares the catalogue. Match that here: a learner's
    // progress card should show progress on every published material, not
    // just the ones this particular trainer uploaded. Otherwise a brand-new
    // trainer sees seven learners all reading "No modules enrolled" even
    // though they have completed modules across the library.
    const visibleModules = await db
      .select({ id: trainingMaterials.id, title: trainingMaterials.title })
      .from(trainingMaterials)

    const visibleModuleIds = visibleModules.map((m) => m.id)

    // Active non-trainer staff (the learners). Role comes from the linked
    // auth user since staff.role is no longer stored.
    const learners = await db
      .select({ id: staff.id, name: staff.fullName, email: staff.email, role: user.role })
      .from(staff)
      .leftJoin(user, eq(user.id, staff.userId))
      .where(and(eq(staff.status, 'active'), eq(staff.isExternalTrainer, false)))

    if (learners.length === 0) return c.json({ success: true, data: [] })

    // Progress rows for those modules
    const progressRows =
      visibleModuleIds.length > 0
        ? await db
            .select()
            .from(staffTrainingProgress)
            .where(inArray(staffTrainingProgress.trainingId, visibleModuleIds))
        : []

    const moduleMap = new Map(visibleModules.map((m) => [m.id, m.title]))

    // PR-32 — was a .filter() per learner = O(learners × progress) work in
    // application code. Pre-group into a Map<staffId, rows[]> so the per-
    // learner step becomes a single map lookup. Same output; survives a
    // 500-staff clinic without sweating.
    const progressByStaff = new Map<string, typeof progressRows>()
    for (const row of progressRows) {
      const bucket = progressByStaff.get(row.staffId) ?? []
      bucket.push(row)
      progressByStaff.set(row.staffId, bucket)
    }

    const data = learners.map((l) => {
      const rows = progressByStaff.get(l.id) ?? []
      const progressByModule = rows.map((p) => ({
        trainingId: p.trainingId,
        title: moduleMap.get(p.trainingId) ?? p.trainingId,
        status: p.status,
        progressPercent: p.progressPercent ?? 0,
        score: p.score,
        completedAt: p.completedAt,
      }))
      return { ...l, progressByModule }
    })

    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch learners' }, 500)
  }
})

// ─── Trainer assessments — review completed quiz attempts ─────────────────

/** GET /training/assessments?status=pending|reviewed
 *  Lists completed staff training attempts for the trainer's own modules. */
app.get('/training/assessments', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_TRAINING as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const status = c.req.query('status') // 'pending' | 'reviewed' | undefined (all)
  const db = getDb(process.env.DATABASE_URL!)

  // The trainer cohort is a shared editorial team — materials were de-scoped
  // from uploadedById, so grading spans the whole catalogue too (not just
  // modules this user personally uploaded). Access is gated by
  // STAFF_TRAINING:READ above.
  const allModules = await db
    .select({ id: trainingMaterials.id, title: trainingMaterials.title })
    .from(trainingMaterials)
  if (allModules.length === 0) return c.json({ success: true, data: [] })
  const allModuleIds = allModules.map((m) => m.id)
  const moduleTitleById = new Map(allModules.map((m) => [m.id, m.title]))

  const conds = [
    inArray(staffTrainingProgress.trainingId, allModuleIds),
    eq(staffTrainingProgress.status, 'completed'),
  ]

  const rows = await db
    .select({
      id: staffTrainingProgress.id,
      staffId: staffTrainingProgress.staffId,
      trainingId: staffTrainingProgress.trainingId,
      score: staffTrainingProgress.score,
      completedAt: staffTrainingProgress.completedAt,
      reviewedAt: staffTrainingProgress.reviewedAt,
      reviewedById: staffTrainingProgress.reviewedById,
      trainerFeedback: staffTrainingProgress.trainerFeedback,
      learnerName: staff.fullName,
    })
    .from(staffTrainingProgress)
    .leftJoin(staff, eq(staff.id, staffTrainingProgress.staffId))
    .where(and(...conds))
    .orderBy(desc(staffTrainingProgress.completedAt))

  const filtered =
    status === 'pending'
      ? rows.filter((r) => r.reviewedAt === null)
      : status === 'reviewed'
        ? rows.filter((r) => r.reviewedAt !== null)
        : rows

  const attemptCountsResult = await db
    .select({
      staffId: trainingAttempts.staffId,
      trainingId: trainingAttempts.trainingId,
      attempts: count(),
    })
    .from(trainingAttempts)
    .where(inArray(trainingAttempts.trainingId, allModuleIds))
    .groupBy(trainingAttempts.staffId, trainingAttempts.trainingId)

  const attemptMap = new Map<string, number>()
  for (const row of attemptCountsResult) {
    attemptMap.set(`${row.staffId}|${row.trainingId}`, row.attempts)
  }

  const data = filtered.map((r) => ({
    id: r.id,
    staffId: r.staffId,
    learnerName: r.learnerName,
    trainingId: r.trainingId,
    moduleName: moduleTitleById.get(r.trainingId) ?? r.trainingId,
    score: r.score,
    completedAt: r.completedAt,
    reviewedAt: r.reviewedAt,
    trainerFeedback: r.trainerFeedback,
    attemptsCount: attemptMap.get(`${r.staffId}|${r.trainingId}`) ?? 0,
    status: r.reviewedAt ? ('reviewed' as const) : ('pending' as const),
  }))
  return c.json({ success: true, data })
})

/** GET /training/assessments/:id — single attempt detail. */
app.get('/training/assessments/:id{[0-9a-fA-F-]{36}}', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_TRAINING as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .select({
      progress: staffTrainingProgress,
      module: trainingMaterials,
      learnerName: staff.fullName,
      learnerStaffCode: staff.staffId,
    })
    .from(staffTrainingProgress)
    .innerJoin(trainingMaterials, eq(trainingMaterials.id, staffTrainingProgress.trainingId))
    .leftJoin(staff, eq(staff.id, staffTrainingProgress.staffId))
    .where(eq(staffTrainingProgress.id, id))
    .limit(1)
  if (!row) return c.json({ error: 'Submission not found' }, 404)

  return c.json({
    success: true,
    data: {
      id: row.progress.id,
      staffId: row.progress.staffId,
      learnerName: row.learnerName,
      learnerStaffCode: row.learnerStaffCode,
      trainingId: row.module.id,
      moduleName: row.module.title,
      moduleDescription: row.module.description,
      passingScore: row.module.passingScore,
      questions: row.module.quizQuestions ?? [],
      score: row.progress.score,
      completedAt: row.progress.completedAt,
      reviewedAt: row.progress.reviewedAt,
      reviewedById: row.progress.reviewedById,
      trainerFeedback: row.progress.trainerFeedback,
      status: row.progress.reviewedAt ? ('reviewed' as const) : ('pending' as const),
    },
  })
})

/** PATCH /training/assessments/:id — body: { trainerFeedback?: string }
 *  Marks the attempt as reviewed by the current trainer. */
app.patch('/training/assessments/:id{[0-9a-fA-F-]{36}}', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_TRAINING as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const db = getDb(process.env.DATABASE_URL!)

  // Confirm the attempt exists. Grading is a shared-editorial-team action
  // (gated by STAFF_TRAINING:UPDATE above), not restricted to the uploader.
  const [row] = await db
    .select({ progressId: staffTrainingProgress.id })
    .from(staffTrainingProgress)
    .where(eq(staffTrainingProgress.id, id))
    .limit(1)
  if (!row) return c.json({ error: 'Submission not found' }, 404)

  const [updated] = await db
    .update(staffTrainingProgress)
    .set({
      trainerFeedback: typeof body.trainerFeedback === 'string' ? body.trainerFeedback : null,
      reviewedAt: new Date(),
      reviewedById: authUser.id,
      updatedAt: new Date(),
    })
    .where(eq(staffTrainingProgress.id, id))
    .returning()

  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'review_training_attempt',
    module: 'staff_training',
    entityId: id,
    entityName: `attempt ${id}`,
    changes: { feedback: !!body.trainerFeedback },
  })

  return c.json({ success: true, data: updated })
})

/** Get single training material by id */
app.get('/training/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_TRAINING as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    const material = await db.query.trainingMaterials.findFirst({
      where: eq(trainingMaterials.id, id),
      with: { progress: true },
    })
    if (!material) return c.json({ error: 'Not found' }, 404)

    // PR-45 — the original PR-30 ownership guard restricted non-admins to
    // materials they uploaded. With the bundle now scoped to admin +
    // external_trainer only (no broad-staff READ), that guard prevented
    // trainers from opening any module they didn't personally create —
    // including the existing library seeded by the admin. The clinic-level
    // trust model treats the trainer cohort as a shared editorial team, so
    // we drop the guard at the material level — and the assessment review
    // endpoints follow the same model (gated by STAFF_TRAINING perms, not
    // uploadedById), so any trainer can grade any module's attempts.

    // §15.1 — layer the read-time due/overdue/expired view onto each progress
    // row so consumers can render the renewal state without re-deriving it.
    const now = new Date()
    const progress = Array.isArray(material.progress)
      ? material.progress.map((p) => ({ ...p, derivedStatus: deriveTrainingStatus(p, now) }))
      : material.progress
    return c.json({ success: true, data: { ...material, progress } })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch training material' }, 500)
  }
})

export { app as staffTrainingApp }
