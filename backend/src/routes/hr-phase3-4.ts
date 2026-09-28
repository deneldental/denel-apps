/**
 * Phases 3B–4C — shifts, credential enhancements, audit export, bundle
 * composition admin endpoints.
 *
 * Mounted at /api/hr3 to keep namespaces predictable. Training attempts
 * are read-only here (write paths flow through the existing quiz submit
 * in staff-portal which is updated separately).
 */

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  auditLogs,
  permissionBundles,
  shiftAssignments,
  shifts,
  staff,
  staffCredentialDocuments,
  staffCredentials,
  trainingAttempts,
  user,
} from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const hrPhase34 = new Hono<HonoEnv>()

// ─── Phase 3B — shifts + roster ──────────────────────────────────────────────

hrPhase34.get('/shifts', async (c) => {
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
  const rows = await db.select().from(shifts).orderBy(shifts.name)
  return c.json({ success: true, data: rows })
})

hrPhase34.post('/shifts', async (c) => {
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
    startTime?: string
    endTime?: string
    weekdays?: number[]
    color?: string
  }
  if (!body.name || !body.startTime || !body.endTime) {
    return c.json({ error: 'name, startTime, endTime required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(shifts)
    .values({
      name: body.name,
      startTime: body.startTime,
      endTime: body.endTime,
      weekdays: body.weekdays ?? [1, 2, 3, 4, 5],
      color: body.color ?? null,
    })
    .returning()
  return c.json({ success: true, data: row })
})

hrPhase34.get('/roster', async (c) => {
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

  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json({ error: 'from and to (YYYY-MM-DD) required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select({
      id: shiftAssignments.id,
      shiftId: shiftAssignments.shiftId,
      staffId: shiftAssignments.staffId,
      date: shiftAssignments.date,
      status: shiftAssignments.status,
      notes: shiftAssignments.notes,
      shiftName: shifts.name,
      shiftStart: shifts.startTime,
      shiftEnd: shifts.endTime,
      shiftColor: shifts.color,
      staffName: staff.fullName,
    })
    .from(shiftAssignments)
    .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
    .innerJoin(staff, eq(staff.id, shiftAssignments.staffId))
    .where(
      and(gte(shiftAssignments.date, from), lte(shiftAssignments.date, to), isNull(staff.deletedAt))
    )
    .orderBy(shiftAssignments.date, shifts.startTime)
  return c.json({ success: true, data: rows })
})

hrPhase34.post('/roster', async (c) => {
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
    assignments?: Array<{ shiftId: string; staffId: string; date: string; notes?: string }>
  }
  const items = Array.isArray(body.assignments) ? body.assignments : []
  if (items.length === 0) return c.json({ error: 'assignments[] is required' }, 400)
  if (items.length > 500) return c.json({ error: 'Bulk roster capped at 500 entries' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  await db.insert(shiftAssignments).values(
    items.map((a) => ({
      shiftId: a.shiftId,
      staffId: a.staffId,
      date: a.date,
      notes: a.notes ?? null,
      createdById: authUser.id,
    }))
  )
  return c.json({ success: true, data: { inserted: items.length } })
})

// ─── Phase 3C — training attempts (read) ─────────────────────────────────────

hrPhase34.get('/training/:trainingId/attempts', async (c) => {
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

  const trainingId = c.req.param('trainingId')
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select({
      id: trainingAttempts.id,
      staffId: trainingAttempts.staffId,
      staffName: staff.fullName,
      attemptNumber: trainingAttempts.attemptNumber,
      score: trainingAttempts.score,
      passed: trainingAttempts.passed,
      awaitingReview: trainingAttempts.awaitingReview,
      submittedAt: trainingAttempts.submittedAt,
    })
    .from(trainingAttempts)
    .innerJoin(staff, eq(staff.id, trainingAttempts.staffId))
    .where(eq(trainingAttempts.trainingId, trainingId))
    .orderBy(desc(trainingAttempts.submittedAt))
  return c.json({ success: true, data: rows })
})

// ─── Phase 3D — credential verification + version history ────────────────────

hrPhase34.post('/credentials/:credentialId/verify', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, authUser.id, MODULES.COMPLIANCE as string, ACTIONS.UPDATE as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const credentialId = c.req.param('credentialId')
  const body = (await c.req.json().catch(() => ({}))) as {
    method?: 'manual_check' | 'phone_to_issuer' | 'online_registry' | 'document_only'
    notes?: string
  }
  if (!body.method) return c.json({ error: 'method is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const existing = await db.query.staffCredentials.findFirst({
    where: eq(staffCredentials.id, credentialId),
  })
  if (!existing) return c.json({ error: 'Credential not found' }, 404)

  const now = new Date()
  await db
    .update(staffCredentials)
    .set({
      verifiedById: authUser.id,
      verifiedAt: now,
      verificationMethod: body.method,
      updatedAt: now,
    })
    .where(eq(staffCredentials.id, credentialId))

  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'credential_verified',
    module: 'compliance',
    entityId: credentialId,
    entityName: `${existing.credentialName} (${existing.credentialType})`,
    changes: { method: body.method, notes: body.notes },
  })
  return c.json({ success: true })
})

hrPhase34.post('/credentials/:credentialId/documents', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, authUser.id, MODULES.COMPLIANCE as string, ACTIONS.UPDATE as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const credentialId = c.req.param('credentialId')
  const body = (await c.req.json().catch(() => ({}))) as {
    documentUrl?: string
    issueDate?: string
    expiryDate?: string
    notes?: string
  }
  if (!body.documentUrl) return c.json({ error: 'documentUrl is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const credential = await db.query.staffCredentials.findFirst({
    where: eq(staffCredentials.id, credentialId),
  })
  if (!credential) return c.json({ error: 'Credential not found' }, 404)

  const [lastVersionRow] = await db
    .select({ max: sql<number>`coalesce(max(${staffCredentialDocuments.versionNumber}), 0)::int` })
    .from(staffCredentialDocuments)
    .where(eq(staffCredentialDocuments.credentialId, credentialId))
  const nextVersion = (lastVersionRow?.max ?? 0) + 1

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(staffCredentialDocuments).values({
      credentialId,
      versionNumber: nextVersion,
      documentUrl: body.documentUrl as string,
      issueDate: body.issueDate ? new Date(body.issueDate) : null,
      expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
      uploadedById: authUser.id,
      notes: body.notes ?? null,
    })

    // Roll the canonical document on the credential row. Clear the
    // auto-suspend flag if the new expiry is in the future.
    const nextExpiry = body.expiryDate ? new Date(body.expiryDate) : credential.expiryDate
    const clearsLapse = nextExpiry && nextExpiry > now
    await tx
      .update(staffCredentials)
      .set({
        documentUrl: body.documentUrl as string,
        issueDate: body.issueDate ? new Date(body.issueDate) : credential.issueDate,
        expiryDate: nextExpiry,
        suspendedDueToLapse: clearsLapse ? false : credential.suspendedDueToLapse,
        updatedAt: now,
      })
      .where(eq(staffCredentials.id, credentialId))
  })

  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'credential_document_added',
    module: 'compliance',
    entityId: credentialId,
    changes: { version: nextVersion },
  })
  return c.json({ success: true, data: { versionNumber: nextVersion } })
})

hrPhase34.get('/credentials/:credentialId/documents', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, authUser.id, MODULES.COMPLIANCE as string, ACTIONS.READ as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const credentialId = c.req.param('credentialId')
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(staffCredentialDocuments)
    .where(eq(staffCredentialDocuments.credentialId, credentialId))
    .orderBy(desc(staffCredentialDocuments.versionNumber))
  return c.json({ success: true, data: rows })
})

/**
 * GET /api/hr3/credentials/compliance-report
 *
 * Regulator-facing export. Returns every clinical staff member with each
 * of their credentials and the current status. Streamed as CSV when
 * `?format=csv`, otherwise JSON.
 */
hrPhase34.get('/credentials/compliance-report', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, authUser.id, MODULES.COMPLIANCE as string, ACTIONS.READ as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const now = new Date()
  const rows = await db
    .select({
      staffId: staff.id,
      staffName: staff.fullName,
      position: staff.position,
      credentialId: staffCredentials.id,
      credentialType: staffCredentials.credentialType,
      credentialName: staffCredentials.credentialName,
      issuingBody: staffCredentials.issuingBody,
      issueDate: staffCredentials.issueDate,
      expiryDate: staffCredentials.expiryDate,
      verifiedAt: staffCredentials.verifiedAt,
      verificationMethod: staffCredentials.verificationMethod,
      suspendedDueToLapse: staffCredentials.suspendedDueToLapse,
    })
    .from(staffCredentials)
    .innerJoin(staff, eq(staff.id, staffCredentials.staffId))
    .where(isNull(staff.deletedAt))
    .orderBy(staff.fullName, staffCredentials.credentialType)

  const enriched = rows.map((r) => ({
    ...r,
    status:
      r.expiryDate && r.expiryDate < now ? 'lapsed' : r.verifiedAt ? 'verified' : 'unverified',
  }))

  if (c.req.query('format') === 'csv') {
    const header = [
      'Staff Name',
      'Position',
      'Credential Type',
      'Credential Name',
      'Issuing Body',
      'Issue Date',
      'Expiry Date',
      'Status',
      'Verified At',
      'Verification Method',
    ].join(',')
    const lines = enriched.map((r) =>
      [
        csvEscape(r.staffName),
        csvEscape(r.position ?? ''),
        csvEscape(r.credentialType),
        csvEscape(r.credentialName),
        csvEscape(r.issuingBody ?? ''),
        r.issueDate ? r.issueDate.toISOString().slice(0, 10) : '',
        r.expiryDate ? r.expiryDate.toISOString().slice(0, 10) : '',
        r.status,
        r.verifiedAt ? r.verifiedAt.toISOString().slice(0, 19) : '',
        r.verificationMethod ?? '',
      ].join(',')
    )
    const csv = `${header}\n${lines.join('\n')}\n`
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="credentials-compliance-${now.toISOString().slice(0, 10)}.csv"`,
      },
    })
  }

  return c.json({ success: true, data: enriched })
})

// ─── Phase 4A — audit log compliance export ──────────────────────────────────

hrPhase34.get('/audit-report', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, authUser.id, MODULES.AUDIT_LOGS as string, ACTIONS.READ as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const from = c.req.query('from')
  const to = c.req.query('to')
  const moduleFilter = c.req.query('module') // optional CSV: 'access_management,staff'
  if (!from || !to) return c.json({ error: 'from and to (ISO) required' }, 400)

  const fromDate = new Date(from)
  const toDate = new Date(to)
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return c.json({ error: 'from / to must parse as dates' }, 400)
  }

  const modules = moduleFilter
    ? moduleFilter
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean)
    : null

  const db = getDb(process.env.DATABASE_URL!)
  const conditions = [gte(auditLogs.createdAt, fromDate), lte(auditLogs.createdAt, toDate)] as const
  const whereExpr = modules
    ? and(...conditions, inArray(auditLogs.module, modules))
    : and(...conditions)

  const rows = await db
    .select({
      id: auditLogs.id,
      userId: auditLogs.userId,
      actorName: user.name,
      action: auditLogs.action,
      module: auditLogs.module,
      entityId: auditLogs.entityId,
      entityName: auditLogs.entityName,
      reason: auditLogs.reason,
      ipAddress: auditLogs.ipAddress,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(user, eq(user.id, auditLogs.userId))
    .where(whereExpr)
    .orderBy(asc(auditLogs.createdAt))
    .limit(50_000)

  if (c.req.query('format') === 'csv') {
    const header = ['Timestamp', 'Actor', 'Module', 'Action', 'Entity', 'Reason', 'IP'].join(',')
    const lines = rows.map((r) =>
      [
        r.createdAt.toISOString(),
        csvEscape(r.actorName ?? r.userId),
        csvEscape(r.module),
        csvEscape(r.action),
        csvEscape(r.entityName ?? r.entityId ?? ''),
        csvEscape(r.reason ?? ''),
        csvEscape(r.ipAddress ?? ''),
      ].join(',')
    )
    return new Response(`${header}\n${lines.join('\n')}\n`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-report-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  }

  return c.json({ success: true, data: rows })
})

// ─── Phase 4B — bundle composition ───────────────────────────────────────────

hrPhase34.patch('/bundles/:bundleId/parent', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.ACCESS_MANAGEMENT as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const bundleId = c.req.param('bundleId')
  const body = (await c.req.json().catch(() => ({}))) as { parentBundleId?: string | null }
  const nextParent = body.parentBundleId ?? null

  if (nextParent === bundleId) {
    return c.json({ error: 'A bundle cannot be its own parent.' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  if (nextParent) {
    // Cycle detection
    const visited = new Set<string>()
    let cursor: string | null = nextParent
    while (cursor) {
      if (cursor === bundleId) {
        return c.json(
          { error: 'Refused — this would create a cycle in the bundle hierarchy.' },
          400
        )
      }
      if (visited.has(cursor)) break
      visited.add(cursor)
      const rows: Array<{ parentBundleId: string | null }> = await db
        .select({ parentBundleId: permissionBundles.parentBundleId })
        .from(permissionBundles)
        .where(eq(permissionBundles.id, cursor))
        .limit(1)
      cursor = rows[0]?.parentBundleId ?? null
    }
  }

  await db
    .update(permissionBundles)
    .set({ parentBundleId: nextParent, updatedAt: new Date() })
    .where(eq(permissionBundles.id, bundleId))

  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'bundle_parent_changed',
    module: 'access_management',
    entityId: bundleId,
    changes: { parentBundleId: nextParent },
  })
  return c.json({ success: true })
})

// ─── Helper ──────────────────────────────────────────────────────────────────

function csvEscape(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export { hrPhase34 }
