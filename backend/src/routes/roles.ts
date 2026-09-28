/**
 * Role & Bundle Management Routes — admin only
 *
 * All routes require: authenticated session + admin role.
 * The admin bypass in PermissionEngine means admin users pass all checks.
 */

import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { permissions, rolePermissions, user } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { getCurrentUser, isAdmin } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { type AppScope, resolveRolePermissions } from '../rbac/engine/BundleResolver'
import { PermissionEngine } from '../rbac/engine/PermissionEngine'
import { BundleService } from '../services/BundleService'
import { RoleService } from '../services/RoleService'

const rolesApp = new Hono<HonoEnv>()

// ─── Admin gate ───────────────────────────────────────────────────────────────

async function requireAdmin(c: any): Promise<string | null> {
  const authUser = await getCurrentUser(c)
  if (!authUser) return null
  const admin = await isAdmin(c, authUser.id)
  if (!admin) return null
  return authUser.id
}

// ─── Roles ────────────────────────────────────────────────────────────────────

rolesApp.get('/', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const service = new RoleService(db)
  const roles = await service.listRoles()
  return c.json({ success: true, data: roles })
})

rolesApp.get('/:id', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const service = new RoleService(db)
  const role = await service.getRoleWithDetails(c.req.param('id'))
  if (!role) return c.json({ error: 'Role not found' }, 404)
  return c.json({ success: true, data: role })
})

rolesApp.post('/', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const body = await c.req.json()
  const { name, description, scopes, bundleIds } = body

  if (!name || typeof name !== 'string') {
    return c.json({ error: 'name is required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const service = new RoleService(db)

  try {
    const role = await service.createRole({
      name,
      description,
      scopes: scopes ?? [],
      bundleIds: bundleIds ?? [],
    })

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: adminId,
      action: 'role_created',
      module: 'access_management',
      entityId: role.id,
      entityName: role.name,
      afterJson: role,
    })

    return c.json({ success: true, data: { id: role.id, name: role.name } }, 201)
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Bad request' }, 400)
  }
})

rolesApp.patch('/:id', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)
  const service = new RoleService(db)

  try {
    const result = await service.updateRole(c.req.param('id'), body)

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: adminId,
      action: 'role_updated',
      module: 'access_management',
      entityId: c.req.param('id'),
      entityName: result.after.name ?? result.before.name ?? null,
      beforeJson: result.before,
      afterJson: result.after,
    })

    return c.json({ success: true })
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Bad request' }, 400)
  }
})

rolesApp.delete('/:id', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const service = new RoleService(db)

  try {
    const result = await service.deleteRole(c.req.param('id'))

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: adminId,
      action: 'role_deleted',
      module: 'access_management',
      entityId: result.id,
      entityName: result.name,
    })

    return c.json({ success: true })
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Bad request' }, 400)
  }
})

// ─── Role bundles ─────────────────────────────────────────────────────────────

rolesApp.put('/:id/bundles', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const body = await c.req.json()
  const { bundleIds } = body

  if (!Array.isArray(bundleIds)) {
    return c.json({ error: 'bundleIds must be an array' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const service = new RoleService(db)

  try {
    const result = await service.setRoleBundles(c.req.param('id'), bundleIds)

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: adminId,
      action: 'role_bundles_updated',
      module: 'access_management',
      entityId: c.req.param('id'),
      beforeJson: { bundleIds: result.before },
      afterJson: { bundleIds: result.after },
      changes: {
        added: result.diff.added,
        removed: result.diff.removed,
      },
    })

    return c.json({ success: true, data: { diff: result.diff } })
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Bad request' }, 400)
  }
})

// ─── Role scopes ──────────────────────────────────────────────────────────────

rolesApp.put('/:id/scopes', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const body = await c.req.json()
  const { scopes } = body

  if (!Array.isArray(scopes)) {
    return c.json({ error: 'scopes must be an array' }, 400)
  }

  const validScopes = ['portal', 'pwa', 'hr']
  if (scopes.some((s) => !validScopes.includes(s))) {
    return c.json({ error: 'Invalid scope. Use: portal | pwa | hr' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const service = new RoleService(db)

  try {
    const result = await service.setRoleScopes(c.req.param('id'), scopes)

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: adminId,
      action: 'role_scopes_updated',
      module: 'access_management',
      entityId: c.req.param('id'),
      beforeJson: { scopes: result.before },
      afterJson: { scopes: result.after },
    })

    return c.json({ success: true })
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Bad request' }, 400)
  }
})

// ─── Bundles ──────────────────────────────────────────────────────────────────

rolesApp.get('/bundles/all', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const service = new BundleService(db)
  const bundles = await service.listBundles()
  return c.json({ success: true, data: bundles })
})

rolesApp.get('/bundles/:id', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const service = new BundleService(db)
  const bundle = await service.getBundleWithPermissions(c.req.param('id'))
  if (!bundle) return c.json({ error: 'Bundle not found' }, 404)
  return c.json({ success: true, data: bundle })
})

rolesApp.post('/bundles', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const body = await c.req.json()
  const { name, description, scope, permissionIds } = body

  if (!name || !scope) {
    return c.json({ error: 'name and scope are required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const service = new BundleService(db)

  try {
    const bundle = await service.createBundle(
      { name, description, scope, permissionIds: permissionIds ?? [] },
      adminId
    )

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: adminId,
      action: 'bundle_created',
      module: 'access_management',
      entityId: bundle.id,
      entityName: bundle.name,
      afterJson: bundle,
    })

    return c.json({ success: true, data: { id: bundle.id, name: bundle.name } }, 201)
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Bad request' }, 400)
  }
})

rolesApp.patch('/bundles/:id', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)
  const service = new BundleService(db)

  try {
    const result = await service.updateBundle(c.req.param('id'), body)

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: adminId,
      action: 'bundle_updated',
      module: 'access_management',
      entityId: result.id,
      entityName: result.after.name,
      beforeJson: result.before,
      afterJson: result.after,
    })

    return c.json({ success: true })
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Bad request' }, 400)
  }
})

rolesApp.delete('/bundles/:id', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const service = new BundleService(db)

  try {
    const result = await service.deleteBundle(c.req.param('id'))

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: adminId,
      action: 'bundle_deleted',
      module: 'access_management',
      entityId: result.id,
      entityName: result.name,
    })

    return c.json({ success: true })
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Bad request' }, 400)
  }
})

// ─── All available permissions (for bundle builder UI) ────────────────────────

rolesApp.get('/permissions/all', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const allPermissions = await db
    .select({
      id: permissions.id,
      module: permissions.module,
      action: permissions.action,
      description: permissions.description,
    })
    .from(permissions)
    .orderBy(permissions.module, permissions.action)

  return c.json({ success: true, data: allPermissions })
})

// ─── Role permission matrix ───────────────────────────────────────────────────

// GET /api/roles/:id/permissions?scope=portal|pwa|hr
// Returns every known permission with `granted` flag.
// mode: 'matrix'    — role has explicit rows for this scope
//       'bundle'    — no matrix rows; using bundle-resolved grants
//       'inherited' — scope=pwa requested but no pwa rows exist; returns portal grants as fallback
rolesApp.get('/:id/permissions', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const roleId = c.req.param('id')
  const rawScope = c.req.query('scope') ?? 'portal'
  if (rawScope !== 'portal' && rawScope !== 'pwa' && rawScope !== 'hr') {
    return c.json({ error: 'Invalid scope. Use: portal | pwa | hr' }, 400)
  }
  // 'hr' used to be rejected here — role_scopes accepted it but the matrix
  // editor did not, so an admin could grant HR interface access and then had no
  // way to see or edit what that role could do in HR.
  const scope: AppScope = rawScope
  const db = getDb(process.env.DATABASE_URL!)

  // All available permissions
  const allPerms = await db
    .select({
      id: permissions.id,
      module: permissions.module,
      action: permissions.action,
      description: permissions.description,
    })
    .from(permissions)
    .orderBy(permissions.module, permissions.action)

  // Check if role has matrix rows for the requested scope
  const scopedMatrixRows = await db
    .select({ permissionId: rolePermissions.permissionId })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.scope, scope)))

  let mode: 'matrix' | 'bundle' | 'inherited'
  let effectiveSet: Set<string>

  if (scope === 'pwa' && scopedMatrixRows.length === 0) {
    // No PWA-specific rows yet — fall back to portal effective grants
    mode = 'inherited'
    const portalEffective = await resolveRolePermissions(db, roleId, 'portal')
    effectiveSet = new Set(portalEffective.map((p) => `${p.module}:${p.action}`))
  } else if (scopedMatrixRows.length > 0) {
    mode = 'matrix'
    const scopedEffective = await resolveRolePermissions(db, roleId, scope)
    effectiveSet = new Set(scopedEffective.map((p) => `${p.module}:${p.action}`))
  } else {
    // Portal scope, no matrix rows — bundle mode
    mode = 'bundle'
    const effective = await resolveRolePermissions(db, roleId, 'portal')
    effectiveSet = new Set(effective.map((p) => `${p.module}:${p.action}`))
  }

  const result = allPerms.map((p) => ({
    id: p.id,
    module: p.module,
    action: p.action,
    description: p.description,
    granted: effectiveSet.has(`${p.module}:${p.action}`),
  }))

  return c.json({ success: true, data: { roleId, mode, scope, permissions: result } })
})

// PUT /api/roles/:id/permissions?scope=portal|pwa
// Body: { permissions: string[] }  where each entry is "module:action"
// Replaces all rolePermissions rows for this (role, scope) and switches to matrix mode.
rolesApp.put('/:id/permissions', async (c) => {
  const adminId = await requireAdmin(c)
  if (!adminId) return c.json({ error: 'Admin access required' }, 403)

  const roleId = c.req.param('id')
  const scope = (c.req.query('scope') ?? 'portal') as 'portal' | 'pwa'
  const body = await c.req.json()

  if (!Array.isArray(body.permissions)) {
    return c.json({ error: 'permissions must be an array of "module:action" strings' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)

  // Resolve permission IDs for the given module:action pairs
  const pairs = (body.permissions as string[])
    .map((s) => {
      const [module, action] = s.split(':')
      return { module, action }
    })
    .filter((p) => p.module && p.action)

  const permRows =
    pairs.length > 0
      ? await db
          .select({ id: permissions.id, module: permissions.module, action: permissions.action })
          .from(permissions)
      : []

  const pairSet = new Set(pairs.map((p) => `${p.module}:${p.action}`))
  const matchedIds = permRows.filter((r) => pairSet.has(`${r.module}:${r.action}`)).map((r) => r.id)

  // Atomic replace: delete existing rows for this (role, scope), then insert new ones
  await db
    .delete(rolePermissions)
    .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.scope, scope)))
  if (matchedIds.length > 0) {
    await db
      .insert(rolePermissions)
      .values(matchedIds.map((permissionId) => ({ roleId, permissionId, scope })))
  }

  // Invalidate cache for all users holding this role
  const usersWithRole = await db.select({ id: user.id }).from(user).where(eq(user.roleId, roleId))
  const engine = new PermissionEngine(db)
  await Promise.all(usersWithRole.map((u) => engine.invalidateCache(u.id)))

  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: adminId,
    action: 'role_permissions_updated',
    module: 'access_management',
    entityId: roleId,
    entityName: `Role: ${roleId}`,
    changes: { scope, permissionCount: matchedIds.length, permissions: body.permissions },
  })

  return c.json({ success: true, data: { permissionCount: matchedIds.length, scope } })
})

export { rolesApp }
