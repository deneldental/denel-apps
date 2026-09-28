/**
 * RoleService — CRUD for roles and role assignments
 *
 * Manages the lifecycle of roles:
 * - System roles: read-only (admin, doctor, receptionist, external_trainer)
 * - Custom roles: full CRUD via admin UI
 *
 * Also manages role → bundle assignments and role → scope grants.
 * All mutations that affect permissions invalidate the permission cache.
 */

import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../db/schema'
import { PermissionEngine } from '../rbac/engine/PermissionEngine'
import { diffBundles } from '../rbac/utils/permissionDiff'

type DB = NodePgDatabase<typeof schema>

export type CreateRoleInput = {
  name: string
  description?: string
  scopes: Array<'portal' | 'pwa' | 'hr'>
  bundleIds: string[]
}

export type UpdateRoleInput = Partial<Pick<CreateRoleInput, 'name' | 'description'>>

export class RoleService {
  private db: DB
  private engine: PermissionEngine

  constructor(db: DB) {
    this.db = db
    this.engine = new PermissionEngine(db)
  }

  async listRoles() {
    const roles = await this.db.select().from(schema.roles).orderBy(schema.roles.name)

    // Attach scopes and bundle count to each role
    const enriched = await Promise.all(
      roles.map(async (role) => {
        const scopes = await this.db
          .select({ interfaceScope: schema.roleScopes.interfaceScope })
          .from(schema.roleScopes)
          .where(eq(schema.roleScopes.roleId, role.id))

        const bundles = await this.db
          .select({ bundleId: schema.roleBundles.bundleId })
          .from(schema.roleBundles)
          .where(eq(schema.roleBundles.roleId, role.id))

        return {
          ...role,
          scopes: scopes.map((s) => s.interfaceScope),
          bundleCount: bundles.length,
        }
      })
    )

    return enriched
  }

  async getRoleWithDetails(roleId: string) {
    const role = await this.db.query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
    })

    if (!role) return null

    const [scopes, bundles] = await Promise.all([
      this.db
        .select({ interfaceScope: schema.roleScopes.interfaceScope })
        .from(schema.roleScopes)
        .where(eq(schema.roleScopes.roleId, roleId)),
      this.db
        .select({
          id: schema.permissionBundles.id,
          name: schema.permissionBundles.name,
          description: schema.permissionBundles.description,
          scope: schema.permissionBundles.scope,
          isSystem: schema.permissionBundles.isSystem,
        })
        .from(schema.roleBundles)
        .innerJoin(
          schema.permissionBundles,
          eq(schema.roleBundles.bundleId, schema.permissionBundles.id)
        )
        .where(eq(schema.roleBundles.roleId, roleId)),
    ])

    return {
      ...role,
      scopes: scopes.map((s) => s.interfaceScope),
      bundles,
    }
  }

  async createRole(input: CreateRoleInput) {
    const id = crypto.randomUUID()

    // Multi-step write — atomic so a partial failure cannot leave a role
    // without its scopes/bundles. Without the transaction a crash between
    // inserts would create an orphan role row.
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.roles).values({
        id,
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
      })

      if (input.scopes.length > 0) {
        await tx
          .insert(schema.roleScopes)
          .values(input.scopes.map((scope) => ({ roleId: id, interfaceScope: scope })))
      }

      if (input.bundleIds.length > 0) {
        await tx
          .insert(schema.roleBundles)
          .values(input.bundleIds.map((bundleId) => ({ roleId: id, bundleId })))
      }
    })

    return {
      id,
      name: input.name,
      description: input.description ?? null,
      scopes: input.scopes,
      bundleIds: input.bundleIds,
    }
  }

  async updateRole(roleId: string, input: UpdateRoleInput) {
    const role = await this.db.query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
    })

    if (!role) throw new Error('Role not found')
    if (role.isSystem) throw new Error('System roles cannot be renamed or deleted')

    const before = { name: role.name, description: role.description }

    await this.db
      .update(schema.roles)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.roles.id, roleId))

    return { before, after: { ...before, ...input } }
  }

  /**
   * Replace the full set of bundles assigned to a role.
   * Computes a diff for audit logging and invalidates the cache.
   *
   * System roles are locked — was previously a gap that allowed silent
   * bundle edits on `admin`/`doctor` etc. while `setRoleScopes` blocked them.
   */
  async setRoleBundles(roleId: string, newBundleIds: string[]) {
    const role = await this.db.query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
    })
    if (!role) throw new Error('Role not found')
    if (role.isSystem) throw new Error('System role bundles cannot be modified')

    // Get current bundles for diff
    const current = await this.db
      .select({ bundleId: schema.roleBundles.bundleId })
      .from(schema.roleBundles)
      .where(eq(schema.roleBundles.roleId, roleId))

    const currentIds = current.map((r) => r.bundleId)
    const diff = diffBundles(currentIds, newBundleIds)

    // Atomic replace — delete-then-reinsert must not leave the role empty
    // if the insert errors.
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.roleBundles).where(eq(schema.roleBundles.roleId, roleId))
      if (newBundleIds.length > 0) {
        await tx
          .insert(schema.roleBundles)
          .values(newBundleIds.map((bundleId) => ({ roleId, bundleId })))
      }
    })

    // Invalidate permission cache for all users with this role
    await this.engine.invalidateCacheForRole(roleId)

    return { diff, before: currentIds, after: newBundleIds }
  }

  /**
   * Replace the scope grants for a role.
   */
  async setRoleScopes(roleId: string, scopes: Array<'portal' | 'pwa' | 'hr'>) {
    const role = await this.db.query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
    })
    if (!role) throw new Error('Role not found')
    if (role.isSystem) throw new Error('System role scopes cannot be modified')

    const before = await this.db
      .select({ interfaceScope: schema.roleScopes.interfaceScope })
      .from(schema.roleScopes)
      .where(eq(schema.roleScopes.roleId, roleId))

    await this.db.transaction(async (tx) => {
      await tx.delete(schema.roleScopes).where(eq(schema.roleScopes.roleId, roleId))
      if (scopes.length > 0) {
        await tx
          .insert(schema.roleScopes)
          .values(scopes.map((scope) => ({ roleId, interfaceScope: scope })))
      }
    })

    // Invalidate cache — scope changes affect access decisions
    await this.engine.invalidateCacheForRole(roleId)

    return { before: before.map((r) => r.interfaceScope), after: scopes }
  }

  async deleteRole(roleId: string) {
    const role = await this.db.query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
    })

    if (!role) throw new Error('Role not found')
    if (role.isSystem) throw new Error('System roles cannot be deleted')

    // Check if any users are assigned this role
    const usages = await this.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.roleId, roleId))
      .limit(1)

    if (usages.length > 0) {
      throw new Error('Role is assigned to one or more users. Reassign them first.')
    }

    // Invalidate cache before deletion
    await this.engine.invalidateCacheForRole(roleId)

    await this.db.delete(schema.roles).where(eq(schema.roles.id, roleId))

    return { id: roleId, name: role.name }
  }

  /**
   * Assign a role to a user. Invalidates that user's permission cache.
   */
  async assignRoleToUser(userId: string, roleId: string, assignedById: string) {
    const role = await this.db.query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
    })
    if (!role) throw new Error('Role not found')

    await this.db
      .update(schema.user)
      .set({ roleId, updatedAt: new Date() })
      .where(eq(schema.user.id, userId))

    await this.engine.invalidateCache(userId)

    return { userId, roleId, assignedById }
  }
}
