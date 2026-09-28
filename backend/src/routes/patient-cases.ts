import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { Hono } from 'hono'
import { env } from '../config/env'
import { getDb } from '../db'
import {
  caseStages,
  items,
  patientCases,
  patients,
  prescriptions,
  treatmentPlanItems,
  treatmentPlans,
} from '../db/schema'
import { account, user } from '../db/schema/auth'
import { createAuditLog, recordDiffAudit } from '../lib/audit'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES, ROLES } from '../lib/modules'
import { verifyPassword } from '../lib/password'
import { applyOrthoTag } from '../lib/patient-auto-tag'
import { ensureCaseForPlan, linkPlanToCase, nextCaseNumber } from '../lib/patient-case-service'
import { gateByPlan } from '../lib/treatment-gate'
import type { HonoEnv } from '../lib/types'
import { checkPermission } from '../rbac/middleware/checkPermission'
import { verifySession } from '../rbac/middleware/verifySession'

// Valid stage types — v1 legacy entries kept readable; v2 entries are the
// canonical set that the redefined clinical flow writes.
const VALID_STAGE_TYPES = [
  // v1 legacy
  'patient_concern',
  'oral_health',
  // v2 canonical
  'presenting_complaint',
  'history_of_presenting_complaint',
  'past_medical_surgical_history',
  'drug_history_allergies',
  'social_history',
  'diagnosis',
  'examination',
  'treatment_plan',
  // Estimate step (0168): the doctor's pre-treatment pricing draft for a visit.
  'estimate',
  'prescription',
  // §2.5 — merged Review stage (subType: general | ortho). Legacy dental_review /
  // ortho_review remain valid so existing cases stay readable.
  'review',
  'dental_review',
  'ortho_review',
] as const

/**
 * Stage types that constitute treatment DELIVERY rather than assessment.
 * Dispensing has a cost; taking a history does not.
 */
const GATED_STAGE_TYPES: string[] = ['prescription']

const createdByUser = alias(user, 'created_by_user')
const closedByUser = alias(user, 'closed_by_user')

const patientCasesApp = new Hono<HonoEnv>()

// Case-number generation lives in ../lib/patient-case-service so the plan
// creation paths mint numbers the same way (max-suffix, not row count).

// ── GET /api/patient-cases/patient/:patientId ─────────────────────────────────

patientCasesApp.get(
  '/patient/:patientId',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.READ as string),
  async (c) => {
    try {
      const { patientId } = c.req.param()
      const statusFilter = c.req.query('status')
      const db = getDb(env.DATABASE_URL)

      // Plain select + aliased joins to avoid relational query named-relation issues
      const rows = await db
        .select({
          id: patientCases.id,
          caseNumber: patientCases.caseNumber,
          status: patientCases.status,
          chiefComplaint: patientCases.chiefComplaint,
          createdAt: patientCases.createdAt,
          updatedAt: patientCases.updatedAt,
          closedAt: patientCases.closedAt,
          patientId: patientCases.patientId,
          createdById: patientCases.createdById,
          closedById: patientCases.closedById,
          createdByName: createdByUser.name,
          closedByName: closedByUser.name,
        })
        .from(patientCases)
        .leftJoin(createdByUser, eq(patientCases.createdById, createdByUser.id))
        .leftJoin(closedByUser, eq(patientCases.closedById, closedByUser.id))
        .where(
          and(
            eq(patientCases.patientId, patientId),
            isNull(patientCases.deletedAt),
            statusFilter ? eq(patientCases.status, statusFilter) : undefined
          )
        )
        .orderBy(desc(patientCases.createdAt))

      const cases = rows.map((r) => ({
        id: r.id,
        caseNumber: r.caseNumber,
        status: r.status,
        chiefComplaint: r.chiefComplaint,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        closedAt: r.closedAt,
        patientId: r.patientId,
        createdBy: r.createdById ? { id: r.createdById, name: r.createdByName ?? '' } : null,
        closedBy: r.closedById ? { id: r.closedById, name: r.closedByName ?? '' } : null,
      }))

      return c.json({ success: true, data: cases })
    } catch (err: unknown) {
      logError(err, { context: '[patient-cases] GET /patient/:id error' })
      const pgErr = err as { message?: string }
      return c.json({ error: pgErr.message ?? 'Failed to fetch cases' }, 500)
    }
  }
)

// ── GET /api/patient-cases/patient/:patientId/prescriptions ──────────────────

patientCasesApp.get(
  '/patient/:patientId/prescriptions',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.READ as string),
  async (c) => {
    try {
      const { patientId } = c.req.param()
      const db = getDb(env.DATABASE_URL)

      const rows = await db
        .select({
          id: prescriptions.id,
          medication: prescriptions.medication,
          dosage: prescriptions.dosage,
          frequency: prescriptions.frequency,
          duration: prescriptions.duration,
          notes: prescriptions.notes,
          createdAt: prescriptions.createdAt,
          caseId: prescriptions.caseId,
          caseNumber: patientCases.caseNumber,
        })
        .from(prescriptions)
        .leftJoin(patientCases, eq(prescriptions.caseId, patientCases.id))
        .where(eq(prescriptions.patientId, patientId))
        .orderBy(desc(prescriptions.createdAt))

      return c.json({ success: true, data: rows })
    } catch (err: unknown) {
      logError(err, { context: '[patient-cases] GET /patient/:id/prescriptions error' })
      const pgErr = err as { message?: string }
      return c.json({ error: pgErr.message ?? 'Failed to fetch prescriptions' }, 500)
    }
  }
)

// ── GET /api/patient-cases/patient/:patientId/prescription-groups ─────────────

patientCasesApp.get(
  '/patient/:patientId/prescription-groups',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.READ as string),
  async (c) => {
    try {
      const { patientId } = c.req.param()
      const db = getDb(env.DATABASE_URL)

      const rows = await db
        .select({
          id: prescriptions.id,
          medication: prescriptions.medication,
          dosage: prescriptions.dosage,
          frequency: prescriptions.frequency,
          duration: prescriptions.duration,
          notes: prescriptions.notes,
          createdAt: prescriptions.createdAt,
          caseId: prescriptions.caseId,
          caseNumber: patientCases.caseNumber,
        })
        .from(prescriptions)
        .leftJoin(patientCases, eq(prescriptions.caseId, patientCases.id))
        .where(eq(prescriptions.patientId, patientId))
        .orderBy(desc(prescriptions.createdAt))

      // Group by caseId server-side; ungrouped rows each form their own group
      const map = new Map<
        string,
        {
          key: string
          caseNumber: string | null
          createdAt: Date
          notes: string | null
          drugs: typeof rows
        }
      >()
      for (const row of rows) {
        const key = row.caseId ?? row.id
        if (!map.has(key)) {
          map.set(key, {
            key,
            caseNumber: row.caseNumber,
            createdAt: row.createdAt,
            notes: row.notes,
            drugs: [],
          })
        }
        map.get(key)?.drugs.push(row)
      }

      return c.json({ success: true, data: Array.from(map.values()) })
    } catch (err: unknown) {
      logError(err, { context: '[patient-cases] GET /patient/:id/prescription-groups error' })
      const pgErr = err as { message?: string }
      return c.json({ error: pgErr.message ?? 'Failed to fetch prescription groups' }, 500)
    }
  }
)

// ── GET /api/patient-cases/patient/:patientId/prescription-stages ─────────────

patientCasesApp.get(
  '/patient/:patientId/prescription-stages',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.READ as string),
  async (c) => {
    try {
      const { patientId } = c.req.param()
      const db = getDb(env.DATABASE_URL)

      const rows = await db
        .select({
          id: caseStages.id,
          data: caseStages.data,
          createdAt: caseStages.createdAt,
          caseId: patientCases.id,
          caseNumber: patientCases.caseNumber,
          createdByName: createdByUser.name,
        })
        .from(caseStages)
        .innerJoin(patientCases, eq(caseStages.caseId, patientCases.id))
        .leftJoin(createdByUser, eq(caseStages.createdById, createdByUser.id))
        .where(
          and(
            eq(patientCases.patientId, patientId),
            eq(caseStages.stageType, 'prescription'),
            isNull(caseStages.deletedAt),
            isNull(patientCases.deletedAt)
          )
        )
        .orderBy(desc(caseStages.createdAt))

      return c.json({ success: true, data: rows })
    } catch (err: unknown) {
      logError(err, { context: '[patient-cases] GET /patient/:id/prescription-stages error' })
      const pgErr = err as { message?: string }
      return c.json({ error: pgErr.message ?? 'Failed to fetch prescription stages' }, 500)
    }
  }
)

// ── GET /api/patient-cases/patient/:patientId/treatment-stages ────────────────

patientCasesApp.get(
  '/patient/:patientId/treatment-stages',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.READ as string),
  async (c) => {
    try {
      const { patientId } = c.req.param()
      const db = getDb(env.DATABASE_URL)

      const rows = await db
        .select({
          id: caseStages.id,
          data: caseStages.data,
          createdAt: caseStages.createdAt,
          caseId: patientCases.id,
          caseNumber: patientCases.caseNumber,
          createdByName: createdByUser.name,
        })
        .from(caseStages)
        .innerJoin(patientCases, eq(caseStages.caseId, patientCases.id))
        .leftJoin(createdByUser, eq(caseStages.createdById, createdByUser.id))
        .where(
          and(
            eq(patientCases.patientId, patientId),
            eq(caseStages.stageType, 'treatment_plan'),
            isNull(caseStages.deletedAt),
            isNull(patientCases.deletedAt)
          )
        )
        .orderBy(desc(caseStages.createdAt))

      return c.json({ success: true, data: rows })
    } catch (err: unknown) {
      logError(err, { context: '[patient-cases] GET /patient/:id/treatment-stages error' })
      const pgErr = err as { message?: string }
      return c.json({ error: pgErr.message ?? 'Failed to fetch treatment stages' }, 500)
    }
  }
)

// ── GET /api/patient-cases — clinic-wide list ─────────────────────────────────

patientCasesApp.get(
  '/',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.READ as string),
  async (c) => {
    try {
      const db = getDb(env.DATABASE_URL)
      const statusFilter = c.req.query('status')
      const search = c.req.query('search')?.trim()
      const page = Math.max(1, Number(c.req.query('page') ?? 1))
      const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 25)))
      const offset = (page - 1) * limit

      const patientAlias = alias(patients, 'p')

      const conditions = [
        isNull(patientCases.deletedAt),
        statusFilter ? eq(patientCases.status, statusFilter) : undefined,
        search
          ? or(
              ilike(patientCases.caseNumber, `%${search}%`),
              ilike(patientAlias.name, `%${search}%`)
            )
          : undefined,
      ].filter(Boolean) as ReturnType<typeof eq>[]

      const rows = await db
        .select({
          id: patientCases.id,
          caseNumber: patientCases.caseNumber,
          status: patientCases.status,
          chiefComplaint: patientCases.chiefComplaint,
          createdAt: patientCases.createdAt,
          closedAt: patientCases.closedAt,
          patientId: patientAlias.id,
          patientName: patientAlias.name,
          patientPublicId: patientAlias.patientId,
          createdById: patientCases.createdById,
          createdByName: createdByUser.name,
          planId: patientCases.planId,
          planTitle: treatmentPlans.title,
        })
        .from(patientCases)
        .leftJoin(patientAlias, eq(patientCases.patientId, patientAlias.id))
        .leftJoin(createdByUser, eq(patientCases.createdById, createdByUser.id))
        .leftJoin(treatmentPlans, eq(patientCases.planId, treatmentPlans.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(patientCases.createdAt))
        .limit(limit)
        .offset(offset)

      const data = rows.map((r) => ({
        id: r.id,
        caseNumber: r.caseNumber,
        status: r.status,
        chiefComplaint: r.chiefComplaint,
        createdAt: r.createdAt,
        closedAt: r.closedAt,
        patient: { id: r.patientId, name: r.patientName, patientId: r.patientPublicId },
        createdBy: r.createdById ? { id: r.createdById, name: r.createdByName ?? '' } : null,
        plan: r.planId ? { id: r.planId, title: r.planTitle ?? 'Plan' } : null,
      }))

      return c.json({ success: true, data, page, limit })
    } catch (err: unknown) {
      logError(err, { context: '[patient-cases] GET / error' })
      const pgErr = err as { message?: string }
      return c.json({ error: pgErr.message ?? 'Failed to fetch cases' }, 500)
    }
  }
)

// ── GET /api/patient-cases/prescription-stages/all ───────────────────────────

patientCasesApp.get(
  '/prescription-stages/all',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.READ as string),
  async (c) => {
    try {
      const db = getDb(env.DATABASE_URL)
      const search = c.req.query('search')?.trim()
      const page = Math.max(1, Number(c.req.query('page') ?? 1))
      const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 25)))
      const offset = (page - 1) * limit

      const patientAlias = alias(patients, 'p')

      const rows = await db
        .select({
          id: caseStages.id,
          data: caseStages.data,
          createdAt: caseStages.createdAt,
          caseId: patientCases.id,
          caseNumber: patientCases.caseNumber,
          patientId: patientAlias.id,
          patientName: patientAlias.name,
          patientPublicId: patientAlias.patientId,
          createdByName: createdByUser.name,
        })
        .from(caseStages)
        .innerJoin(patientCases, eq(caseStages.caseId, patientCases.id))
        .innerJoin(patientAlias, eq(patientCases.patientId, patientAlias.id))
        .leftJoin(createdByUser, eq(caseStages.createdById, createdByUser.id))
        .where(
          and(
            eq(caseStages.stageType, 'prescription'),
            isNull(caseStages.deletedAt),
            isNull(patientCases.deletedAt),
            search ? ilike(patientAlias.name, `%${search}%`) : undefined
          )
        )
        .orderBy(desc(caseStages.createdAt))
        .limit(limit)
        .offset(offset)

      const data = rows.map((r) => ({
        id: r.id,
        data: r.data,
        createdAt: r.createdAt,
        caseId: r.caseId,
        caseNumber: r.caseNumber,
        patient: { id: r.patientId, name: r.patientName, patientId: r.patientPublicId },
        createdByName: r.createdByName,
      }))

      return c.json({ success: true, data, page, limit })
    } catch (err: unknown) {
      logError(err, { context: '[patient-cases] GET /prescription-stages/all error' })
      const pgErr = err as { message?: string }
      return c.json({ error: pgErr.message ?? 'Failed to fetch prescription stages' }, 500)
    }
  }
)

// ── GET /api/patient-cases/:id ────────────────────────────────────────────────

patientCasesApp.get(
  '/:id',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.READ as string),
  async (c) => {
    try {
      const { id } = c.req.param()
      const db = getDb(env.DATABASE_URL)

      const [caseRow] = await db
        .select({
          id: patientCases.id,
          caseNumber: patientCases.caseNumber,
          status: patientCases.status,
          chiefComplaint: patientCases.chiefComplaint,
          createdAt: patientCases.createdAt,
          updatedAt: patientCases.updatedAt,
          closedAt: patientCases.closedAt,
          patientId: patientCases.patientId,
          planId: patientCases.planId,
          createdById: patientCases.createdById,
          closedById: patientCases.closedById,
        })
        .from(patientCases)
        .where(and(eq(patientCases.id, id), isNull(patientCases.deletedAt)))

      if (!caseRow) return c.json({ error: 'Case not found' }, 404)

      // Fetch creator + closer names
      const userIds = [caseRow.createdById, caseRow.closedById].filter(Boolean) as string[]
      const userRows = userIds.length
        ? await db
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(inArray(user.id, userIds))
        : []
      const userMap = Object.fromEntries(userRows.map((u) => [u.id, u.name]))

      // Fetch stages with stage-creator names via aliased join
      const stageRows = await db
        .select({
          id: caseStages.id,
          caseId: caseStages.caseId,
          stageType: caseStages.stageType,
          data: caseStages.data,
          status: caseStages.status,
          visitDate: caseStages.visitDate,
          planItemId: caseStages.planItemId,
          createdAt: caseStages.createdAt,
          updatedAt: caseStages.updatedAt,
          createdById: caseStages.createdById,
          createdByName: createdByUser.name,
        })
        .from(caseStages)
        .leftJoin(createdByUser, eq(caseStages.createdById, createdByUser.id))
        .where(and(eq(caseStages.caseId, id), isNull(caseStages.deletedAt)))
        // Order by visit first so same-visit stages stay contiguous for grouping.
        .orderBy(asc(caseStages.visitDate), asc(caseStages.createdAt))

      const stages = stageRows.map((s) => ({
        id: s.id,
        caseId: s.caseId,
        stageType: s.stageType,
        data: s.data,
        status: s.status,
        visitDate: s.visitDate,
        planItemId: s.planItemId,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        createdBy: s.createdById ? { id: s.createdById, name: s.createdByName ?? '' } : null,
      }))

      // Fetch plan and plan items if linked
      let plan = null
      let planItems: any[] = []
      if (caseRow.planId) {
        const [planRow] = await db
          .select()
          .from(treatmentPlans)
          .where(eq(treatmentPlans.id, caseRow.planId))
        if (planRow) {
          plan = planRow
          planItems = await db
            .select()
            .from(treatmentPlanItems)
            .where(eq(treatmentPlanItems.planId, planRow.id))
            .orderBy(asc(treatmentPlanItems.sortOrder))
        }
      }

      return c.json({
        success: true,
        data: {
          ...caseRow,
          createdBy: caseRow.createdById
            ? { id: caseRow.createdById, name: userMap[caseRow.createdById] ?? '' }
            : null,
          closedBy: caseRow.closedById
            ? { id: caseRow.closedById, name: userMap[caseRow.closedById] ?? '' }
            : null,
          stages,
          plan,
          planItems,
        },
      })
    } catch (err: unknown) {
      logError(err, { context: '[patient-cases] GET /:id error' })
      const pgErr = err as { message?: string }
      return c.json({ error: pgErr.message ?? 'Failed to fetch case' }, 500)
    }
  }
)

// ── POST /api/patient-cases ───────────────────────────────────────────────────

patientCasesApp.post(
  '/',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.CREATE as string),
  async (c) => {
    try {
      const user = c.var.user
      const body = await c.req.json()

      if (!body.patientId) return c.json({ error: 'patientId required' }, 400)

      const db = getDb(env.DATABASE_URL)
      c.set('skipAudit', true)
      const caseNumber = await nextCaseNumber(db)

      const [created] = await db
        .insert(patientCases)
        .values({
          patientId: body.patientId,
          caseNumber,
          status: 'open',
          createdById: user.id,
        })
        .returning()

      await createAuditLog(db, {
        userId: user.id,
        action: 'create',
        module: MODULES.PATIENTS as string,
        entityId: created.id,
        entityName: `Case ${created.caseNumber}`,
        afterJson: created,
      })

      return c.json({ success: true, data: created }, 201)
    } catch (err) {
      logError(err, { route: 'patient-cases.create' })
      return c.json({ error: 'Failed to create case', code: 'CASE_CREATE_FAILED' }, 500)
    }
  }
)

// ── PATCH /api/patient-cases/:id ──────────────────────────────────────────────

patientCasesApp.patch(
  '/:id',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.UPDATE as string),
  async (c) => {
    try {
      const user = c.var.user
      const { id } = c.req.param()
      const body = await c.req.json()
      const db = getDb(env.DATABASE_URL)
      c.set('skipAudit', true)

      const [existing] = await db.select().from(patientCases).where(eq(patientCases.id, id))
      if (!existing) return c.json({ error: 'Case not found' }, 404)

      const updates: Partial<typeof patientCases.$inferInsert> = { updatedAt: new Date() }
      if (body.chiefComplaint !== undefined) updates.chiefComplaint = body.chiefComplaint
      if (body.status !== undefined) {
        updates.status = body.status
        if (body.status === 'closed' && existing.status !== 'closed') {
          updates.closedById = user.id
          updates.closedAt = new Date()
        }
      }

      const [updated] = await db
        .update(patientCases)
        .set(updates)
        .where(eq(patientCases.id, id))
        .returning()

      await recordDiffAudit(db, {
        userId: user.id,
        action: 'update',
        module: MODULES.PATIENTS as string,
        entityId: updated.id,
        entityName: `Case ${updated.caseNumber}`,
        before: existing,
        after: updated,
      })

      return c.json({ success: true, data: updated })
    } catch (err) {
      logError(err, { route: 'patient-cases.update' })
      return c.json({ error: 'Failed to update case', code: 'CASE_UPDATE_FAILED' }, 500)
    }
  }
)

// ── DELETE /api/patient-cases/:id — soft delete ──────────────────────────────
// Clinical data linked to a patient is never hard-deleted by a regular delete:
// it's flagged with `deletedAt` so the row stays auditable. Admins purge for
// real via `POST /:id/permanent` (password gated).

patientCasesApp.delete(
  '/:id',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.DELETE as string),
  async (c) => {
    try {
      const user = c.var.user
      const { id } = c.req.param()
      const db = getDb(env.DATABASE_URL)
      c.set('skipAudit', true)

      const [existing] = await db
        .select()
        .from(patientCases)
        .where(and(eq(patientCases.id, id), isNull(patientCases.deletedAt)))
      if (!existing) return c.json({ error: 'Case not found' }, 404)

      const now = new Date()
      const [softDeleted] = await db
        .update(patientCases)
        .set({ deletedAt: now, deletedById: user.id, updatedAt: now })
        .where(eq(patientCases.id, id))
        .returning()

      await recordDiffAudit(db, {
        userId: user.id,
        action: 'delete',
        module: MODULES.PATIENTS as string,
        entityId: existing.id,
        entityName: `Case ${existing.caseNumber}`,
        before: existing,
        after: softDeleted,
      })

      return c.json({ success: true, data: { softDeleted: true } })
    } catch (err) {
      logError(err, { route: 'patient-cases.softDelete' })
      return c.json({ error: 'Failed to delete case', code: 'CASE_DELETE_FAILED' }, 500)
    }
  }
)

// ── POST /api/patient-cases/:id/permanent — admin hard delete ────────────────
// Requires the caller to be an admin AND re-enter their password. The row and
// all linked stages cascade away. Used by the Trash/Archive admin flow.

async function verifyAdminPassword(
  db: ReturnType<typeof getDb>,
  userId: string,
  password: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!password) return { ok: false, reason: 'Password is required' }
  const [u] = await db.select({ roleId: user.roleId }).from(user).where(eq(user.id, userId))
  if (!u || u.roleId !== ROLES.ADMIN) {
    return { ok: false, reason: 'Admin role required' }
  }
  const [credential] = await db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .limit(1)
  if (!credential?.password) return { ok: false, reason: 'Password not configured' }
  const valid = await verifyPassword({ hash: credential.password, password })
  if (!valid) return { ok: false, reason: 'Invalid password' }
  return { ok: true }
}

patientCasesApp.post(
  '/:id/permanent',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.DELETE as string),
  async (c) => {
    try {
      const currentUser = c.var.user
      const { id } = c.req.param()
      const body = await c.req.json()
      const db = getDb(env.DATABASE_URL)
      c.set('skipAudit', true)

      const check = await verifyAdminPassword(db, currentUser.id, body.password ?? '')
      if (!check.ok) return c.json({ error: check.reason }, 403)

      const [existing] = await db.select().from(patientCases).where(eq(patientCases.id, id))
      if (!existing) return c.json({ error: 'Case not found' }, 404)

      await db.delete(patientCases).where(eq(patientCases.id, id))

      await recordDiffAudit(db, {
        userId: currentUser.id,
        action: 'delete',
        module: MODULES.PATIENTS as string,
        entityId: existing.id,
        entityName: `Case ${existing.caseNumber} (permanent)`,
        before: existing,
        after: null,
      })

      return c.json({ success: true })
    } catch (err) {
      logError(err, { route: 'patient-cases.permanentDelete' })
      return c.json({ error: 'Failed to permanently delete case' }, 500)
    }
  }
)

// ── POST /api/patient-cases/:id/stages ───────────────────────────────────────

patientCasesApp.post(
  '/:id/stages',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.UPDATE as string),
  async (c) => {
    try {
      const user = c.var.user
      const { id } = c.req.param()
      const body = await c.req.json()
      const db = getDb(env.DATABASE_URL)
      c.set('skipAudit', true)

      if (!body.stageType || !(VALID_STAGE_TYPES as readonly string[]).includes(body.stageType)) {
        return c.json({ error: `stageType must be one of: ${VALID_STAGE_TYPES.join(', ')}` }, 400)
      }

      const [patientCase] = await db
        .select()
        .from(patientCases)
        .where(and(eq(patientCases.id, id), isNull(patientCases.deletedAt)))
      if (!patientCase) return c.json({ error: 'Case not found' }, 404)
      if (patientCase.status === 'closed')
        return c.json({ error: 'Cannot add stages to a closed case' }, 400)

      // ── Treatment payment gate ──────────────────────────────────────────
      // Only DELIVERY stages are gated. Assessment — history, examination,
      // diagnosis, the estimate itself — must stay open, because the clinician
      // has to examine and diagnose before anything can be priced. Gating those
      // would deadlock the flow it is meant to protect.
      //
      // A case with no plan is never gated: walk-ins and pure assessment visits
      // have no estimate behind them.
      if (GATED_STAGE_TYPES.includes(body.stageType) && patientCase.planId) {
        const gate = await gateByPlan(
          {
            db,
            userId: user.id,
            isAdmin: user.roleId === 'admin',
            override: body.override === true,
            overrideReason: body.overrideReason ?? null,
            action: `case_stage:${body.stageType}`,
            entityId: id,
          },
          patientCase.planId
        )
        if (gate) return c.json(gate.body, gate.status)
      }

      const [stage] = await db
        .insert(caseStages)
        .values({
          caseId: id,
          stageType: body.stageType,
          data: body.data ?? {},
          // visitDate groups this stage under a visit; omit → DB default CURRENT_DATE
          ...(body.visitDate ? { visitDate: body.visitDate as string } : {}),
          ...(body.planItemId ? { planItemId: body.planItemId as string } : {}),
          createdById: user.id,
        })
        .returning()

      // §2.7 — auto-tag: an ortho review stage (legacy `ortho_review`, or the
      // merged `review` stage with subType=ortho) applies the 'Ortho' tag to
      // the patient, replacing the old isOrtho boolean. Idempotent + tolerant
      // of a missing tag, so it never blocks the clinical write.
      const isOrthoStage =
        body.stageType === 'ortho_review' ||
        (body.stageType === 'review' && body.data?.subType === 'ortho')
      if (isOrthoStage) {
        await applyOrthoTag(db, patientCase.patientId, user.id)
      }

      // Sync chiefComplaint from patient_concern (legacy) or presenting_complaint (v2)
      if (body.stageType === 'patient_concern' && body.data?.chiefComplaint) {
        await db
          .update(patientCases)
          .set({ chiefComplaint: body.data.chiefComplaint, updatedAt: new Date() })
          .where(eq(patientCases.id, id))
      }
      if (body.stageType === 'presenting_complaint') {
        const items = (body.data?.items as Array<{ displayName?: string; name?: string }>) ?? []
        const summary = items
          .map((i) => i.displayName ?? i.name)
          .filter(Boolean)
          .join(', ')
        if (summary) {
          await db
            .update(patientCases)
            .set({ chiefComplaint: summary, updatedAt: new Date() })
            .where(eq(patientCases.id, id))
        }
      }

      // Create prescription rows when prescription stage is added (supports multi-drug format)
      type DrugInput = {
        medication?: string
        dosage?: string
        frequency?: string
        duration?: string
        inventoryItemId?: string | null
        quantity?: number
      }
      const meds: DrugInput[] =
        Array.isArray(body.data?.medications) && body.data.medications.length > 0
          ? body.data.medications
          : body.data?.medication
            ? [
                {
                  medication: body.data.medication,
                  dosage: body.data.dosage,
                  frequency: body.data.frequency,
                  duration: body.data.duration,
                },
              ]
            : []

      for (const drug of meds) {
        if (!drug.medication?.trim()) continue
        await db.insert(prescriptions).values({
          patientId: patientCase.patientId,
          caseId: id,
          treatmentPlanItemId: null,
          medication: drug.medication,
          dosage: drug.dosage ?? null,
          frequency: drug.frequency ?? null,
          duration: drug.duration ?? null,
          notes: body.data?.notes ?? null,
          createdById: user.id,
        })
        // Deduct inventory when the drug is linked to an inventory item. We
        // don't refuse to record a prescription that takes stock negative —
        // out-of-stock is a clinical decision flagged in the UI, not blocked
        // server-side. Stock can be reconciled by the inventory module.
        if (drug.inventoryItemId) {
          const qty = Math.max(1, Number(drug.quantity ?? 1))
          await db
            .update(items)
            .set({
              stockQuantity: sql`${items.stockQuantity} - ${qty}`,
              updatedAt: new Date(),
            })
            .where(eq(items.id, drug.inventoryItemId))
        }
      }

      // Create treatment plan + items when treatment_plan stage is submitted
      // Supports both staged format ({ stages: [...] }) and flat format ({ entries: [...] })
      const flatEntries: Array<{
        procedureName?: string
        treatmentTypeId?: string
        estimatedCost?: number
        notes?: string
        stageName?: string
      }> = []

      if (Array.isArray(body.data?.stages) && body.data.stages.length > 0) {
        for (const stage of body.data.stages as Array<{
          name?: string
          entries?: Array<{
            procedureName?: string
            treatmentTypeId?: string
            estimatedCost?: number
            notes?: string
          }>
        }>) {
          for (const e of stage.entries ?? []) {
            flatEntries.push({ ...e, notes: [stage.name, e.notes].filter(Boolean).join(' — ') })
          }
        }
      } else if (Array.isArray(body.data?.entries) && body.data.entries.length > 0) {
        flatEntries.push(...body.data.entries)
      }

      if (flatEntries.length > 0) {
        const [plan] = await db
          .insert(treatmentPlans)
          .values({
            patientId: patientCase.patientId,
            title: `Treatment Plan - ${patientCase.caseNumber}`,
            totalEstimated: flatEntries.reduce((sum, e) => sum + (e.estimatedCost ?? 0), 0),
            status: 'draft',
            createdById: user.id,
          })
          .returning()

        // Adopt this case if it has no plan yet — a plan authored from inside a
        // case belongs to that episode of care, not a fresh case number. Only
        // when the case already carries a different plan do we mint a new one.
        const linked = await linkPlanToCase(db, { caseId: id, planId: plan.id })
        if (!linked) {
          await ensureCaseForPlan(db, {
            planId: plan.id,
            patientId: patientCase.patientId,
            createdById: user.id,
          })
        }

        const items = flatEntries.map((entry, idx) => ({
          planId: plan.id,
          procedureName: entry.procedureName ?? 'Treatment',
          treatmentTypeId: entry.treatmentTypeId ?? null,
          toothNumber: null,
          estimatedCost: entry.estimatedCost ?? 0,
          notes: entry.notes ?? null,
          sortOrder: idx,
          patientCaseId: id,
        }))

        await db.insert(treatmentPlanItems).values(items)
      }

      await createAuditLog(db, {
        userId: user.id,
        action: 'create',
        module: MODULES.PATIENTS as string,
        entityId: stage.id,
        entityName: `Case ${patientCase.caseNumber} / stage ${stage.stageType}`,
        afterJson: stage,
      })

      return c.json({ success: true, data: stage }, 201)
    } catch (err) {
      logError(err, { route: 'patient-cases.stage.create' })
      return c.json({ error: 'Failed to add stage', code: 'STAGE_CREATE_FAILED' }, 500)
    }
  }
)

// ── PATCH /api/patient-cases/:id/stages/:stageId ──────────────────────────────

patientCasesApp.patch(
  '/:id/stages/:stageId',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.UPDATE as string),
  async (c) => {
    try {
      const user = c.var.user
      const { stageId } = c.req.param()
      const body = await c.req.json()
      const db = getDb(env.DATABASE_URL)
      c.set('skipAudit', true)

      const [existing] = await db
        .select()
        .from(caseStages)
        .where(and(eq(caseStages.id, stageId), isNull(caseStages.deletedAt)))
      if (!existing) return c.json({ error: 'Stage not found' }, 404)

      const newStatus: string | undefined =
        body.status !== undefined && body.status !== existing.status ? body.status : undefined

      const [updated] = await db
        .update(caseStages)
        .set({
          data: body.data ?? existing.data,
          ...(newStatus !== undefined ? { status: newStatus } : {}),
          ...(body.visitDate !== undefined ? { visitDate: body.visitDate as string } : {}),
          ...(body.planItemId !== undefined
            ? { planItemId: body.planItemId as string | null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(caseStages.id, stageId))
        .returning()

      if (existing.stageType === 'patient_concern' && body.data?.chiefComplaint !== undefined) {
        await db
          .update(patientCases)
          .set({ chiefComplaint: body.data.chiefComplaint, updatedAt: new Date() })
          .where(eq(patientCases.id, existing.caseId))
      }

      // §5.5 — when a treatment_plan stage status changes, mirror it on all
      // treatment_plan_items for this case. Source of truth = case stage status.
      if (newStatus !== undefined && existing.stageType === 'treatment_plan') {
        const itemStatus =
          newStatus === 'completed'
            ? 'completed'
            : newStatus === 'cancelled'
              ? 'cancelled'
              : newStatus === 'in_progress'
                ? 'scheduled'
                : 'pending'
        await db
          .update(treatmentPlanItems)
          .set({ status: itemStatus, updatedAt: new Date() })
          .where(eq(treatmentPlanItems.patientCaseId, existing.caseId))
      }

      await recordDiffAudit(db, {
        userId: user.id,
        action: 'update',
        module: MODULES.PATIENTS as string,
        entityId: updated.id,
        entityName: `Stage ${updated.stageType}`,
        before: existing,
        after: updated,
      })

      return c.json({ success: true, data: updated })
    } catch (err) {
      logError(err, { route: 'patient-cases.stage.update' })
      return c.json({ error: 'Failed to update stage', code: 'STAGE_UPDATE_FAILED' }, 500)
    }
  }
)

// ── DELETE /api/patient-cases/:id/stages/:stageId — soft delete ──────────────

patientCasesApp.delete(
  '/:id/stages/:stageId',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.UPDATE as string),
  async (c) => {
    try {
      const currentUser = c.var.user
      const { stageId } = c.req.param()
      const db = getDb(env.DATABASE_URL)
      c.set('skipAudit', true)

      const [existing] = await db
        .select()
        .from(caseStages)
        .where(and(eq(caseStages.id, stageId), isNull(caseStages.deletedAt)))
      if (!existing) return c.json({ error: 'Stage not found' }, 404)

      const now = new Date()
      const [softDeleted] = await db
        .update(caseStages)
        .set({ deletedAt: now, deletedById: currentUser.id, updatedAt: now })
        .where(eq(caseStages.id, stageId))
        .returning()

      await recordDiffAudit(db, {
        userId: currentUser.id,
        action: 'delete',
        module: MODULES.PATIENTS as string,
        entityId: existing.id,
        entityName: `Stage ${existing.stageType}`,
        before: existing,
        after: softDeleted,
      })

      return c.json({ success: true, data: { softDeleted: true } })
    } catch (err) {
      logError(err, { route: 'patient-cases.stage.softDelete' })
      return c.json({ error: 'Failed to delete stage', code: 'STAGE_DELETE_FAILED' }, 500)
    }
  }
)

// ── POST /api/patient-cases/:id/stages/:stageId/permanent — admin hard delete

patientCasesApp.post(
  '/:id/stages/:stageId/permanent',
  verifySession(),
  checkPermission(MODULES.PATIENTS as string, ACTIONS.DELETE as string),
  async (c) => {
    try {
      const currentUser = c.var.user
      const { stageId } = c.req.param()
      const body = await c.req.json()
      const db = getDb(env.DATABASE_URL)
      c.set('skipAudit', true)

      const check = await verifyAdminPassword(db, currentUser.id, body.password ?? '')
      if (!check.ok) return c.json({ error: check.reason }, 403)

      const [existing] = await db.select().from(caseStages).where(eq(caseStages.id, stageId))
      if (!existing) return c.json({ error: 'Stage not found' }, 404)

      await db.delete(caseStages).where(eq(caseStages.id, stageId))

      await recordDiffAudit(db, {
        userId: currentUser.id,
        action: 'delete',
        module: MODULES.PATIENTS as string,
        entityId: existing.id,
        entityName: `Stage ${existing.stageType} (permanent)`,
        before: existing,
        after: null,
      })

      return c.json({ success: true })
    } catch (err) {
      logError(err, { route: 'patient-cases.stage.permanentDelete' })
      return c.json({ error: 'Failed to permanently delete stage' }, 500)
    }
  }
)

export { patientCasesApp }
