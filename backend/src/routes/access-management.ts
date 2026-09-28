import { and, count, desc, eq, gt, inArray, isNull, like, ne, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  bundlePermissions,
  permissionBundles,
  permissions,
  roleBundles,
  rolePermissions,
  userBundles,
  userScopes,
} from '../db/schema'
import { user } from '../db/schema/auth'
import { patientSessions, patients } from '../db/schema/patients'
import { staff } from '../db/schema/staff'
import { revokeAllSessionsForUser } from '../lib/account-sessions'
import { createAuditLog } from '../lib/audit'
import { logError, logger } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { revokeAllDevices } from '../lib/patient-trusted-device'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { resolveUserPermissions } from '../rbac/engine/BundleResolver'
import { PermissionEngine } from '../rbac/engine/PermissionEngine'

// Valid RBAC roles a staff member can hold. Mirrors the allowlist that used
// to live inside POST /api/staff before role-assignment moved here.
const VALID_STAFF_ROLES = new Set([
  'admin',
  'doctor',
  'receptionist',
  'lab_technician',
  'external_trainer',
  'staff',
])

export const accessManagementApp = new Hono<HonoEnv>()

const MODULE = MODULES.ACCESS_MANAGEMENT

// ── GET /api/access-management — combined staff + patient access table ────────
accessManagementApp.get('/', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const [staffRows, patientRows] = await Promise.all([
      // INNER JOIN so only users with an actual staff record appear here.
      // A LEFT JOIN would surface orphan users (e.g. failed-create leftovers,
      // test logins) as "Staff" rows in the UI, which is misleading.
      db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          image: user.image,
          roleId: user.roleId,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          banned: user.banned,
          staffRecordId: staff.id,
          staffId: staff.staffId,
          staffStatus: staff.status,
          staffType: staff.staffType,
          positionTag: staff.positionTag,
          isClinicalPractitioner: staff.isClinicalPractitioner,
        })
        .from(user)
        .innerJoin(staff, eq(staff.userId, user.id))
        .where(isNull(staff.deletedAt))
        .orderBy(user.name),
      db
        .select({
          id: patients.id,
          name: patients.name,
          phone: patients.phone,
          email: patients.email,
          patientId: patients.patientId,
          pwaAccessEnabled: patients.pwaAccessEnabled,
          pwaAccessGrantedAt: patients.pwaAccessGrantedAt,
          createdAt: patients.createdAt,
        })
        .from(patients)
        .orderBy(patients.name),
    ])

    // Fetch user scope overrides for staff
    const scopeRows = await db.select().from(userScopes)

    const scopeMap = new Map<string, { portal: boolean | null; pwa: boolean | null }>()
    for (const s of scopeRows) {
      const entry = scopeMap.get(s.userId) ?? { portal: null, pwa: null }
      if (s.interfaceScope === 'portal') entry.portal = s.granted
      if (s.interfaceScope === 'pwa') entry.pwa = s.granted
      scopeMap.set(s.userId, entry)
    }

    const staffAccess = staffRows.map((u) => ({
      type: 'staff' as const,
      id: u.id,
      staffRecordId: u.staffRecordId ?? null,
      staffId: u.staffId ?? null,
      name: u.name,
      email: u.email,
      phone: u.phone,
      image: u.image,
      roleId: u.roleId,
      role: u.role,
      banned: u.banned,
      staffStatus: u.staffStatus ?? 'active',
      staffType: u.staffType ?? 'internal',
      positionTag: u.positionTag ?? 'staff',
      isClinicalPractitioner: u.isClinicalPractitioner ?? false,
      // Default for staff with no scope rows: PWA-only. New staff get explicit
      // rows seeded at creation; this fallback only matters for legacy users.
      portalAccess: scopeMap.get(u.id)?.portal ?? false,
      pwaAccess: scopeMap.get(u.id)?.pwa ?? true,
      createdAt: u.createdAt,
    }))

    const patientAccess = patientRows.map((p) => ({
      type: 'patient' as const,
      id: p.id,
      name: p.name,
      email: p.email,
      phone: p.phone,
      patientId: p.patientId,
      portalAccess: false,
      pwaAccess: p.pwaAccessEnabled,
      pwaAccessGrantedAt: p.pwaAccessGrantedAt,
      createdAt: p.createdAt,
    }))

    return c.json({ success: true, data: { staff: staffAccess, patients: patientAccess } })
  } catch (error: unknown) {
    logError(error, { context: 'Access management GET error' })
    return c.json({ error: 'Failed to fetch access data' }, 500)
  }
})

// ── POST /api/access-management/staff/:id/scope — toggle portal/pwa access ───
accessManagementApp.post('/staff/:id/scope', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const targetUserId = c.req.param('id')
  const body = await c.req.json()
  const { scope, granted } = body as { scope: 'portal' | 'pwa' | 'hr'; granted: boolean }

  if (!scope || granted == null) {
    return c.json({ error: 'scope and granted are required' }, 400)
  }
  if (scope !== 'portal' && scope !== 'pwa' && scope !== 'hr') {
    return c.json({ error: 'scope must be portal, pwa or hr' }, 400)
  }

  try {
    const now = new Date()
    // Upsert into user_scopes
    await db
      .insert(userScopes)
      .values({
        userId: targetUserId,
        interfaceScope: scope,
        granted,
        grantedById: authUser.id,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userScopes.userId, userScopes.interfaceScope],
        set: { granted, grantedById: authUser.id, updatedAt: now },
      })

    try {
      const engine = new PermissionEngine(db)
      await engine.invalidateCache(targetUserId)
    } catch (cacheErr) {
      logger.warn({ err: cacheErr }, '[access-management] cache invalidation failed')
    }

    return c.json({ success: true, data: { userId: targetUserId, scope, granted } })
  } catch (error: unknown) {
    logError(error, { context: 'Staff scope update error' })
    return c.json({ error: 'Failed to update scope' }, 500)
  }
})

// ── POST /api/access-management/staff/:userId/offboard ───────────────────────
//
// One-click offboard: unset role, revoke both portal + pwa scopes, ban the
// auth user (Better Auth admin-plugin field), soft-delete the staff record.
// All inside one transaction with a single audit-log entry tagged with the
// HR reason so compliance can trace the chain.
//
// Body: { reason: string } — required, kept on the audit log.
accessManagementApp.post('/staff/:userId/offboard', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const targetUserId = c.req.param('userId')
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string }
  if (!body.reason || body.reason.trim().length < 3) {
    return c.json({ error: 'reason is required (≥3 chars) — captured on the audit log.' }, 400)
  }

  if (authUser.id === targetUserId) {
    return c.json({ error: 'You cannot offboard yourself.' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const targetUser = await db.query.user.findFirst({
      where: eq(user.id, targetUserId),
      columns: { id: true, name: true, role: true, roleId: true, banned: true },
    })
    if (!targetUser) return c.json({ error: 'User not found' }, 404)

    const targetStaff = await db.query.staff.findFirst({
      where: eq(staff.userId, targetUserId),
      columns: { id: true, status: true, deletedAt: true },
    })

    const now = new Date()
    const beforeScopes = await db
      .select({ scope: userScopes.interfaceScope, granted: userScopes.granted })
      .from(userScopes)
      .where(eq(userScopes.userId, targetUserId))

    await db.transaction(async (tx) => {
      // 1. Unset role on the auth user + ban.
      await tx
        .update(user)
        .set({ roleId: null, role: null, banned: true, updatedAt: now })
        .where(eq(user.id, targetUserId))

      // 2. Revoke both interface scopes (upsert to false).
      for (const scope of ['portal', 'pwa'] as const) {
        await tx
          .insert(userScopes)
          .values({
            userId: targetUserId,
            interfaceScope: scope,
            granted: false,
            grantedById: authUser.id,
            reason: `Offboarded: ${body.reason}`,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [userScopes.userId, userScopes.interfaceScope],
            set: {
              granted: false,
              grantedById: authUser.id,
              reason: `Offboarded: ${body.reason}`,
              updatedAt: now,
            },
          })
      }

      // 3. Soft-delete the staff record if it exists and isn't already deleted.
      if (targetStaff?.id && !targetStaff.deletedAt) {
        await tx
          .update(staff)
          .set({ deletedAt: now, deletedById: authUser.id, status: 'inactive', updatedAt: now })
          .where(eq(staff.id, targetStaff.id))
      }

      // 4. End every live session, every mechanism, in the same transaction.
      //    Setting `banned` above does NOT do this: Better Auth enforces bans
      //    in a session-CREATE hook (it blocks the next sign-in), and only its
      //    own /admin/ban-user endpoint deletes session rows — which this path
      //    bypasses by writing the column directly.
      await revokeAllSessionsForUser(tx, targetUserId)
    })

    // 5. Invalidate the permission cache. Belt and braces now that the
    //    sessions themselves are gone.
    try {
      const engine = new PermissionEngine(db)
      await engine.invalidateCache(targetUserId)
    } catch (cacheErr) {
      logger.warn({ err: cacheErr }, '[access-management] offboard cache invalidation failed')
    }

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'staff_offboarded',
      module: 'access_management',
      entityId: targetUserId,
      entityName: targetUser.name,
      beforeJson: {
        role: targetUser.roleId ?? targetUser.role,
        banned: targetUser.banned,
        scopes: beforeScopes,
        staffStatus: targetStaff?.status ?? null,
      },
      afterJson: {
        role: null,
        banned: true,
        scopes: [
          { scope: 'portal', granted: false },
          { scope: 'pwa', granted: false },
        ],
        staffStatus: 'inactive',
        staffDeleted: !!targetStaff?.id,
      },
      reason: body.reason,
    })

    return c.json({
      success: true,
      data: { userId: targetUserId, offboarded: true, staffSoftDeleted: !!targetStaff?.id },
    })
  } catch (error: unknown) {
    logError(error, { context: '[access-management offboard]' })
    return c.json({ error: 'Failed to offboard staff' }, 500)
  }
})

// ── PATCH /api/access-management/staff/:userId/role — assign or unassign role ─
//
// Canonical role-update path. Writes user.role + user.roleId (RBAC FK so
// PermissionEngine sees the change immediately) and syncs the linked staff
// record's HR-style role label. HR's POST/PATCH /api/staff intentionally
// cannot touch role — this is the only writer.
//
// Body: { role: 'admin' | 'doctor' | 'receptionist' | 'lab_technician'
//                | 'external_trainer' | 'staff' | null }
accessManagementApp.patch('/staff/:userId/role', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const targetUserId = c.req.param('userId')
  const body = (await c.req.json()) as { role?: string | null }
  const nextRole = body.role === undefined ? null : body.role

  if (nextRole !== null && !VALID_STAFF_ROLES.has(nextRole)) {
    return c.json(
      { error: `Invalid role. Must be one of: ${[...VALID_STAFF_ROLES].join(', ')} or null` },
      400
    )
  }

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const targetUser = await db.query.user.findFirst({
      where: eq(user.id, targetUserId),
      columns: { id: true, name: true, role: true, roleId: true },
    })
    if (!targetUser) return c.json({ error: 'User not found' }, 404)

    // Self-lockout guard: an admin cannot downgrade themselves if no other
    // admin would remain. Prevents the last admin from accidentally locking
    // the org out of access management.
    const isSelf = authUser.id === targetUserId
    const currentlyAdmin = targetUser.roleId === 'admin' || targetUser.role === 'admin'
    if (isSelf && currentlyAdmin && nextRole !== 'admin') {
      const [otherAdmins] = await db
        .select({ count: count() })
        .from(user)
        .where(and(eq(user.roleId, 'admin'), ne(user.id, targetUserId)))
      if ((otherAdmins?.count ?? 0) === 0) {
        return c.json(
          { error: 'Cannot remove your own admin role — no other admin would remain.' },
          400
        )
      }
    }

    const now = new Date()
    await db
      .update(user)
      .set({ role: nextRole, roleId: nextRole, updatedAt: now })
      .where(eq(user.id, targetUserId))
    // Staff record no longer carries `role` — Access Management owns RBAC and
    // writes to user.role only.

    // Invalidate the permission cache for the affected user so the next
    // /api/auth/permissions hit reflects the new role without waiting on TTL.
    try {
      const engine = new PermissionEngine(db)
      await engine.invalidateCache(targetUserId)
    } catch (cacheErr) {
      logger.warn({ err: cacheErr }, '[access-management] cache invalidation failed')
    }

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: nextRole ? 'role_assigned' : 'role_unassigned',
      module: 'access_management',
      entityId: targetUserId,
      entityName: targetUser.name,
      changes: { role: nextRole, previousRole: targetUser.roleId ?? targetUser.role },
    })

    return c.json({ success: true, data: { userId: targetUserId, role: nextRole } })
  } catch (error: unknown) {
    logError(error, { context: 'Staff role update error' })
    return c.json({ error: 'Failed to update role' }, 500)
  }
})

// ── POST /api/access-management/staff/bulk-role ──────────────────────────────
//
// Bulk role assignment. Useful during onboarding (5 new hires get receptionist)
// or org changes. Atomic — either every user is updated or none is. One audit
// row per affected user so a later report can answer "who changed Jane's role
// during the May 2026 reorg?"
//
// Body: { userIds: string[], role: string | null }
accessManagementApp.post('/staff/bulk-role', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    userIds?: string[]
    role?: string | null
  }
  const userIds = Array.isArray(body.userIds)
    ? body.userIds.filter((x) => typeof x === 'string')
    : []
  const nextRole = body.role === undefined ? null : body.role

  if (userIds.length === 0) return c.json({ error: 'userIds[] is required' }, 400)
  if (userIds.length > 100) return c.json({ error: 'bulk operation capped at 100 users' }, 400)
  if (nextRole !== null && !VALID_STAFF_ROLES.has(nextRole)) {
    return c.json(
      { error: `Invalid role. Must be one of: ${[...VALID_STAFF_ROLES].join(', ')} or null` },
      400
    )
  }
  if (userIds.includes(authUser.id) && nextRole !== 'admin') {
    return c.json(
      { error: 'Bulk operation may not include your own user with a non-admin target role.' },
      400
    )
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const targets = await db
      .select({ id: user.id, name: user.name, role: user.role, roleId: user.roleId })
      .from(user)
      .where(inArray(user.id, userIds))
    if (targets.length === 0) return c.json({ error: 'No matching users' }, 404)

    const now = new Date()
    await db.transaction(async (tx) => {
      await tx
        .update(user)
        .set({ role: nextRole, roleId: nextRole, updatedAt: now })
        .where(inArray(user.id, userIds))
    })

    // Cache + audit per affected user.
    const engine = new PermissionEngine(db)
    c.set('skipAudit', true)
    for (const target of targets) {
      try {
        await engine.invalidateCache(target.id)
      } catch (err) {
        logger.warn({ err }, '[access-management bulk] cache invalidation failed')
      }
      await createAuditLog(db, {
        userId: authUser.id,
        action: nextRole ? 'role_assigned_bulk' : 'role_unassigned_bulk',
        module: 'access_management',
        entityId: target.id,
        entityName: target.name,
        beforeJson: { role: target.roleId ?? target.role },
        afterJson: { role: nextRole },
      })
    }

    return c.json({
      success: true,
      data: { updated: targets.length, role: nextRole },
    })
  } catch (error: unknown) {
    logError(error, { context: '[access-management bulk-role]' })
    return c.json({ error: 'Failed to apply bulk role change' }, 500)
  }
})

// ── GET /api/access-management/who-can ───────────────────────────────────────
//
// Reverse lookup: "who can perform (module, action)?" Walks roleBundles →
// bundlePermissions → permissions, then resolves to users via roleId. Admin
// bypass is reported explicitly so the answer never looks empty when there
// are admins who hold the capability via bypass.
//
// Query: ?module=payments&action=create
accessManagementApp.get('/who-can', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const moduleName = c.req.query('module')
  const action = c.req.query('action')
  if (!moduleName || !action) {
    return c.json({ error: 'module and action query params are required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    // Roles that have this (module, action) via any bundle they carry (bundle mode).
    const bundleRoles = await db
      .selectDistinct({ roleId: roleBundles.roleId })
      .from(roleBundles)
      .innerJoin(bundlePermissions, eq(bundlePermissions.bundleId, roleBundles.bundleId))
      .innerJoin(permissions, eq(permissions.id, bundlePermissions.permissionId))
      .where(and(eq(permissions.module, moduleName), eq(permissions.action, action)))

    // Roles that have this (module, action) directly via matrix (role_permissions).
    const matrixRoles = await db
      .selectDistinct({ roleId: rolePermissions.roleId })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(permissions.module, moduleName), eq(permissions.action, action)))

    const roleIds = [...bundleRoles, ...matrixRoles].map((r) => r.roleId)
    // Admins always pass via bypass — surface them separately.
    const grantingRoleIds = Array.from(new Set([...roleIds, 'admin']))

    const grantedUsers = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        roleId: user.roleId,
        banned: user.banned,
      })
      .from(user)
      .where(and(inArray(user.roleId, grantingRoleIds), eq(user.banned, false)))
      .orderBy(user.name)

    return c.json({
      success: true,
      data: {
        module: moduleName,
        action,
        viaRoles: grantingRoleIds,
        users: grantedUsers,
        adminBypass: true,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[access-management who-can]' })
    return c.json({ error: 'Failed to compute reverse lookup' }, 500)
  }
})

// ── GET /api/access-management/users/:userId/permissions ─────────────────────
//
// Returns the flat permission set + bundle list for a given user. Useful
// answer to "what can person Y do?" without becoming them.
accessManagementApp.get('/users/:userId/permissions', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const targetUserId = c.req.param('userId')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const target = await db.query.user.findFirst({
      where: eq(user.id, targetUserId),
      columns: { id: true, name: true, email: true, roleId: true, role: true, banned: true },
    })
    if (!target) return c.json({ error: 'User not found' }, 404)

    // Scope map, resolved exactly the way PermissionEngine.checkScope does:
    // a per-user override wins for that scope, otherwise the role grant decides.
    // The previous version read only user_scopes, ignored role_scopes entirely,
    // had no 'hr' key, and defaulted to { portal: false, pwa: true } — so it
    // reported the opposite of the truth for most users.
    const engine = new PermissionEngine(db)
    const [portalScope, pwaScope, hrScope] = await Promise.all([
      engine.checkScope(targetUserId, 'portal'),
      engine.checkScope(targetUserId, 'pwa'),
      engine.checkScope(targetUserId, 'hr'),
    ])
    const scopeMap = { portal: portalScope, pwa: pwaScope, hr: hrScope }

    if (!target.roleId) {
      return c.json({
        success: true,
        data: {
          user: target,
          adminBypass: false,
          bundles: [],
          permissions: [],
          permissionsByScope: { portal: [], pwa: [] },
          scopes: scopeMap,
        },
      })
    }

    if (target.roleId === 'admin') {
      // Admin bypasses permission checks — report that rather than enumerate
      // everything. Note the scope map above is still real: admin no longer
      // bypasses checkScope, so it correctly shows no Team access.
      return c.json({
        success: true,
        data: {
          user: target,
          adminBypass: true,
          bundles: [],
          permissions: [],
          permissionsByScope: { portal: [], pwa: [] },
          scopes: scopeMap,
        },
      })
    }

    // Resolve through the SAME path as enforcement — resolveUserPermissions is
    // what PermissionEngine.check() calls. The queries that used to live here
    // were a fourth, independent reimplementation that ignored role_permissions
    // .scope (merging portal and pwa rows), user_bundles, bundle parent chains,
    // and MODULE_HIERARCHY expansion. This screen exists to answer "why can't
    // this person do X?", so being the least accurate answer in the system was
    // the worst possible failure mode.
    //
    // Resolved per scope, because since v2 the two genuinely differ: pwa no
    // longer inherits portal bundles, so a receptionist has full front-desk
    // access on the portal and personal self-service only on the Team app.
    const [portalPerms, pwaPerms, bundles] = await Promise.all([
      resolveUserPermissions(db, targetUserId, target.roleId, 'portal'),
      resolveUserPermissions(db, targetUserId, target.roleId, 'pwa'),
      db
        .select({
          id: permissionBundles.id,
          name: permissionBundles.name,
          scope: permissionBundles.scope,
          isSystem: permissionBundles.isSystem,
        })
        .from(roleBundles)
        .innerJoin(permissionBundles, eq(permissionBundles.id, roleBundles.bundleId))
        .where(eq(roleBundles.roleId, target.roleId)),
    ])

    const sortPerms = (rows: { module: string; action: string }[]) =>
      [...rows].sort((a, b) => a.module.localeCompare(b.module) || a.action.localeCompare(b.action))

    // Matrix mode still shadows bundles inside the resolver; surface which one
    // answered so the UI can say so, rather than showing a bundle list that had
    // no bearing on the result.
    const matrixRowCount = await db
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, target.roleId))
      .limit(1)
    const isMatrixMode = matrixRowCount.length > 0

    return c.json({
      success: true,
      data: {
        user: target,
        adminBypass: false,
        bundles: isMatrixMode ? [] : bundles,
        // `permissions` stays the portal set so the existing HR Permissions tab
        // keeps working unchanged; `permissionsByScope` is the full picture.
        permissions: sortPerms(portalPerms),
        permissionsByScope: {
          portal: sortPerms(portalPerms),
          pwa: sortPerms(pwaPerms),
        },
        mode: isMatrixMode ? 'matrix' : 'bundle',
        scopes: scopeMap,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[access-management user-permissions]' })
    return c.json({ error: 'Failed to compute user permissions' }, 500)
  }
})

// ─── Per-user bundle grants (PR-11) ─────────────────────────────────────────
//
// `user_bundles` is the additive layer on top of role bundles. HR uses it to
// grant a single staff member extra access without changing their role —
// e.g. give the new manager portal access by attaching `bundle_clinical_full`
// directly, without inventing a custom role for them.
//
// `bundle_pwa_standard` is auto-granted via this table when a staff record's
// `positionTag` flips to 'staff' (handled in the PATCH /api/staff/:id
// side-effect); the `grantSource` column distinguishes those from manual
// grants so positionTag flip-off can revoke only what it created.

// GET /api/access-management/users/:userId/bundles — list direct grants
//
// Returns the bundles attached to this user via user_bundles (NOT inherited
// from the role). For the full effective permission set, use
// /users/:userId/permissions.
accessManagementApp.get('/users/:userId/bundles', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const targetUserId = c.req.param('userId')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db
      .select({
        bundleId: userBundles.bundleId,
        bundleName: permissionBundles.name,
        scope: permissionBundles.scope,
        grantSource: userBundles.grantSource,
        grantedAt: userBundles.grantedAt,
      })
      .from(userBundles)
      .innerJoin(permissionBundles, eq(permissionBundles.id, userBundles.bundleId))
      .where(eq(userBundles.userId, targetUserId))

    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: '[access-management user-bundles list]' })
    return c.json({ error: 'Failed to list user bundles' }, 500)
  }
})

// POST /api/access-management/users/:userId/bundles — grant a bundle
//
// Body: { bundleId: string }
//
// Always `grantSource = 'manual'`. Auto-grants flow through a different code
// path (the staff PATCH side-effect). Idempotent — re-granting an existing
// bundle is a no-op.
accessManagementApp.post('/users/:userId/bundles', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const targetUserId = c.req.param('userId')
  const body = (await c.req.json().catch(() => null)) as { bundleId?: string } | null
  if (!body?.bundleId) return c.json({ error: 'bundleId is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [bundle] = await db
      .select({ id: permissionBundles.id, name: permissionBundles.name })
      .from(permissionBundles)
      .where(eq(permissionBundles.id, body.bundleId))
      .limit(1)
    if (!bundle) return c.json({ error: 'Bundle not found' }, 404)

    await db
      .insert(userBundles)
      .values({
        userId: targetUserId,
        bundleId: body.bundleId,
        grantedById: authUser.id,
        grantSource: 'manual',
      })
      .onConflictDoNothing()

    // Invalidate the user's cached permissions so the new bundle takes
    // effect on the next checkPermission call.
    await new PermissionEngine(db).invalidateCache(targetUserId)

    await createAuditLog(db, {
      userId: authUser.id,
      action: 'grant_bundle',
      module: 'access_management',
      entityId: targetUserId,
      entityName: bundle.name,
      changes: { bundleId: body.bundleId, source: 'manual' },
    })

    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { context: '[access-management grant-bundle]' })
    return c.json({ error: 'Failed to grant bundle' }, 500)
  }
})

// DELETE /api/access-management/users/:userId/bundles/:bundleId — revoke
//
// Only revokes the exact grant row. Manual grants and auto grants are both
// removed here — auto grants come back automatically if positionTag is
// flipped back to 'staff'.
accessManagementApp.delete('/users/:userId/bundles/:bundleId', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const targetUserId = c.req.param('userId')
  const bundleId = c.req.param('bundleId')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [bundle] = await db
      .select({ name: permissionBundles.name })
      .from(permissionBundles)
      .where(eq(permissionBundles.id, bundleId))
      .limit(1)

    await db
      .delete(userBundles)
      .where(and(eq(userBundles.userId, targetUserId), eq(userBundles.bundleId, bundleId)))

    await new PermissionEngine(db).invalidateCache(targetUserId)

    await createAuditLog(db, {
      userId: authUser.id,
      action: 'revoke_bundle',
      module: 'access_management',
      entityId: targetUserId,
      entityName: bundle?.name ?? bundleId,
      changes: { bundleId },
    })

    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { context: '[access-management revoke-bundle]' })
    return c.json({ error: 'Failed to revoke bundle' }, 500)
  }
})

// GET /api/access-management/bundles — list assignable bundles
//
// Used by the EditAccessSheet to render a "grant bundle" picker. Returns
// every bundle in `permission_bundles` with its scope, so the UI can group
// by portal/pwa/all.
accessManagementApp.get('/bundles', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db
      .select({
        id: permissionBundles.id,
        name: permissionBundles.name,
        description: permissionBundles.description,
        scope: permissionBundles.scope,
        isSystem: permissionBundles.isSystem,
      })
      .from(permissionBundles)

    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: '[access-management list-bundles]' })
    return c.json({ error: 'Failed to list bundles' }, 500)
  }
})

// ─── Patient PWA Management (Phase 5B) ──────────────────────────────────────
//
// The patient PWA is a separate identity system from Better Auth — patients
// live in `patients` and authenticate against `patient_sessions`. They never
// hold role bundles, so the AM "user list" union can't simply JOIN them in.
//
// These endpoints power the dedicated "Patient PWA" tab in Access Management:
// list, view sessions, revoke PWA outright, revoke just the sessions, or kill
// a single session. All gated by access_management:update — same as offboard,
// because revoking patient PWA access has comparable blast radius.

// GET /api/access-management/patients — list patients with PWA access on
//
// Query: ?search=<name|patientId|phone>&page=1&limit=50
//
// Returns paginated rows with the last-session metadata and an active-session
// count so HR can see at a glance which patients are actually using the app.
accessManagementApp.get('/patients', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)

  const search = (c.req.query('search') ?? '').trim()
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1)
  const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query('limit') ?? '50', 10) || 50))
  const offset = (page - 1) * limit

  try {
    const whereExpr = search
      ? and(
          eq(patients.pwaAccessEnabled, true),
          or(
            like(patients.name, `%${search}%`),
            like(patients.patientId, `%${search}%`),
            like(patients.phone, `%${search}%`)
          )
        )
      : eq(patients.pwaAccessEnabled, true)

    const [rows, totalRows] = await Promise.all([
      db
        .select({
          id: patients.id,
          name: patients.name,
          patientId: patients.patientId,
          phone: patients.phone,
          email: patients.email,
          pwaAccessGrantedAt: patients.pwaAccessGrantedAt,
          pwaAccessGrantedById: patients.pwaAccessGrantedById,
          grantedByName: user.name,
        })
        .from(patients)
        .leftJoin(user, eq(user.id, patients.pwaAccessGrantedById))
        .where(whereExpr)
        .orderBy(patients.name)
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(patients).where(whereExpr),
    ])

    const total = totalRows[0]?.n ?? 0
    if (rows.length === 0) {
      return c.json({ success: true, data: { rows: [], total, page, limit } })
    }

    const ids = rows.map((r) => r.id)
    const now = new Date()

    // Pull session counts + most-recent session per patient. One round-trip
    // per stat; cheap because we constrain by the page's patient ids.
    const [sessionCounts, latestSessions] = await Promise.all([
      db
        .select({ patientId: patientSessions.patientId, n: count() })
        .from(patientSessions)
        .where(and(inArray(patientSessions.patientId, ids), gt(patientSessions.expiresAt, now)))
        .groupBy(patientSessions.patientId),
      // Latest non-expired session per patient via DISTINCT ON. Postgres-only,
      // matches the project's existing dialect.
      db.execute(
        sql`
          SELECT DISTINCT ON ("patientId") "patientId", "userAgent", "ipAddress", "lastUsedAt"
          FROM "patient_sessions"
          WHERE "patientId" IN (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `
          )}) AND "expiresAt" > NOW()
          ORDER BY "patientId", "lastUsedAt" DESC
        `
      ),
    ])

    const countMap = new Map<string, number>(sessionCounts.map((r) => [r.patientId, r.n]))
    const latestMap = new Map<
      string,
      { userAgent: string | null; ipAddress: string | null; lastUsedAt: Date }
    >()
    for (const row of latestSessions.rows as Array<{
      patientId: string
      userAgent: string | null
      ipAddress: string | null
      lastUsedAt: Date
    }>) {
      latestMap.set(row.patientId, {
        userAgent: row.userAgent,
        ipAddress: row.ipAddress,
        lastUsedAt: row.lastUsedAt,
      })
    }

    const data = rows.map((r) => ({
      id: r.id,
      name: r.name,
      patientId: r.patientId,
      phone: r.phone,
      email: r.email,
      pwaAccessGrantedAt: r.pwaAccessGrantedAt,
      grantedBy: r.pwaAccessGrantedById
        ? { id: r.pwaAccessGrantedById, name: r.grantedByName }
        : null,
      activeSessionCount: countMap.get(r.id) ?? 0,
      lastSession: latestMap.get(r.id) ?? null,
    }))

    return c.json({ success: true, data: { rows: data, total, page, limit } })
  } catch (error: unknown) {
    logError(error, { context: '[access-management patients]' })
    return c.json({ error: 'Failed to list patient PWA access' }, 500)
  }
})

// GET /api/access-management/patients/:id/sessions — active sessions for one
accessManagementApp.get('/patients/:id/sessions', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const patientId = c.req.param('id')

  try {
    const rows = await db
      .select({
        id: patientSessions.id,
        userAgent: patientSessions.userAgent,
        ipAddress: patientSessions.ipAddress,
        lastUsedAt: patientSessions.lastUsedAt,
        createdAt: patientSessions.createdAt,
        expiresAt: patientSessions.expiresAt,
      })
      .from(patientSessions)
      .where(
        and(eq(patientSessions.patientId, patientId), gt(patientSessions.expiresAt, new Date()))
      )
      .orderBy(desc(patientSessions.lastUsedAt))

    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: '[access-management patient sessions]' })
    return c.json({ error: 'Failed to list patient sessions' }, 500)
  }
})

// POST /api/access-management/patients/:id/revoke-pwa — disable PWA outright
//
// Flips pwaAccessEnabled to false, clears the password hash so a stale OTP
// can't be used to reauth, and kills every session. The patient row stays
// (clinical data lives there) — only the PWA grant is revoked.
accessManagementApp.post('/patients/:id/revoke-pwa', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const patientId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const reason = (body as { reason?: string }).reason?.trim() ?? null

  try {
    const [target] = await db
      .select({ id: patients.id, name: patients.name, enabled: patients.pwaAccessEnabled })
      .from(patients)
      .where(eq(patients.id, patientId))
      .limit(1)

    if (!target) return c.json({ error: 'Patient not found' }, 404)
    if (!target.enabled) return c.json({ error: 'PWA access is already disabled' }, 400)

    let killedSessions = 0
    await db.transaction(async (tx) => {
      await tx
        .update(patients)
        .set({
          pwaAccessEnabled: false,
          pwaPasswordHash: null,
          updatedAt: new Date(),
        })
        .where(eq(patients.id, patientId))

      const killed = await tx
        .delete(patientSessions)
        .where(eq(patientSessions.patientId, patientId))
        .returning({ id: patientSessions.id })
      killedSessions = killed.length
    })

    await createAuditLog(db, {
      userId: authUser.id,
      module: 'access_management',
      action: 'revoke_patient_pwa',
      entityId: patientId,
      entityName: target.name,
      reason,
      changes: { killedSessions, pwaAccessEnabled: false },
    })

    return c.json({ success: true, data: { id: patientId, killedSessions } })
  } catch (error: unknown) {
    logError(error, { context: '[access-management revoke-pwa]' })
    return c.json({ error: 'Failed to revoke patient PWA access' }, 500)
  }
})

// POST /api/access-management/patients/:id/revoke-sessions — kill sessions only
//
// PWA grant stays on; the patient just has to log in again. Useful when a
// device is lost or when HR wants to force a re-verify without disabling
// the patient's portal access.
accessManagementApp.post('/patients/:id/revoke-sessions', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const patientId = c.req.param('id')

  try {
    const [target] = await db
      .select({ id: patients.id, name: patients.name })
      .from(patients)
      .where(eq(patients.id, patientId))
      .limit(1)
    if (!target) return c.json({ error: 'Patient not found' }, 404)

    const killed = await db
      .delete(patientSessions)
      .where(eq(patientSessions.patientId, patientId))
      .returning({ id: patientSessions.id })

    // Also revoke all trusted devices so the next login requires OTP,
    // not just a password re-entry.
    await revokeAllDevices(db, patientId)

    await createAuditLog(db, {
      userId: authUser.id,
      module: 'access_management',
      action: 'revoke_patient_sessions',
      entityId: patientId,
      entityName: target.name,
      changes: { killedSessions: killed.length },
    })

    return c.json({ success: true, data: { id: patientId, killedSessions: killed.length } })
  } catch (error: unknown) {
    logError(error, { context: '[access-management revoke-sessions]' })
    return c.json({ error: 'Failed to revoke patient sessions' }, 500)
  }
})

// DELETE /api/access-management/patient-sessions/:sessionId — kill one session
//
// Fine-grained: useful when the session list shows a suspicious entry and HR
// wants to evict that one device without nuking the others.
accessManagementApp.delete('/patient-sessions/:sessionId', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const sessionId = c.req.param('sessionId')

  try {
    const [session] = await db
      .select({ id: patientSessions.id, patientId: patientSessions.patientId })
      .from(patientSessions)
      .where(eq(patientSessions.id, sessionId))
      .limit(1)
    if (!session) return c.json({ error: 'Session not found' }, 404)

    await db.delete(patientSessions).where(eq(patientSessions.id, sessionId))

    await createAuditLog(db, {
      userId: authUser.id,
      module: 'access_management',
      action: 'revoke_patient_session',
      entityId: session.patientId,
      changes: { sessionId },
    })

    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { context: '[access-management delete-session]' })
    return c.json({ error: 'Failed to delete patient session' }, 500)
  }
})
