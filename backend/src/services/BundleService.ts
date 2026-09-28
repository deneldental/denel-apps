/**
 * BundleService — CRUD for permission bundles
 *
 * Manages the lifecycle of permission bundles:
 * - System bundles: read-only, created via seed script
 * - Custom bundles: full CRUD via admin UI
 *
 * All mutations invalidate the permission cache for affected users.
 */

import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../db/schema'
import { PermissionEngine } from '../rbac/engine/PermissionEngine'

type DB = NodePgDatabase<typeof schema>

export type CreateBundleInput = {
  name: string
  description?: string
  scope: 'portal' | 'pwa' | 'all'
  permissionIds: string[] // UUIDs from the permissions table
}

export type UpdateBundleInput = Partial<Omit<CreateBundleInput, 'permissionIds'>> & {
  permissionIds?: string[]
}

export class BundleService {
  private db: DB
  private engine: PermissionEngine

  constructor(db: DB) {
    this.db = db
    this.engine = new PermissionEngine(db)
  }

  async listBundles() {
    return this.db.select().from(schema.permissionBundles).orderBy(schema.permissionBundles.name)
  }

  async getBundleWithPermissions(bundleId: string) {
    const bundle = await this.db.query.permissionBundles.findFirst({
      where: eq(schema.permissionBundles.id, bundleId),
    })

    if (!bundle) return null

    const permissions = await this.db
      .select({
        id: schema.permissions.id,
        module: schema.permissions.module,
        action: schema.permissions.action,
        description: schema.permissions.description,
      })
      .from(schema.bundlePermissions)
      .innerJoin(
        schema.permissions,
        eq(schema.bundlePermissions.permissionId, schema.permissions.id)
      )
      .where(eq(schema.bundlePermissions.bundleId, bundleId))

    return { ...bundle, permissions }
  }

  async createBundle(input: CreateBundleInput, _createdById: string) {
    const id = crypto.randomUUID()

    await this.db.transaction(async (tx) => {
      await tx.insert(schema.permissionBundles).values({
        id,
        name: input.name,
        description: input.description ?? null,
        scope: input.scope,
        isSystem: false,
      })

      if (input.permissionIds.length > 0) {
        await tx
          .insert(schema.bundlePermissions)
          .values(input.permissionIds.map((permissionId) => ({ bundleId: id, permissionId })))
      }
    })

    return {
      id,
      name: input.name,
      description: input.description ?? null,
      scope: input.scope,
      permissionIds: input.permissionIds,
    }
  }

  async updateBundle(bundleId: string, input: UpdateBundleInput) {
    const bundle = await this.db.query.permissionBundles.findFirst({
      where: eq(schema.permissionBundles.id, bundleId),
    })

    if (!bundle) throw new Error('Bundle not found')
    if (bundle.isSystem) throw new Error('System bundles cannot be modified')

    const { permissionIds, ...fields } = input

    // Capture before state for audit
    const beforePerms = await this.db
      .select({ permissionId: schema.bundlePermissions.permissionId })
      .from(schema.bundlePermissions)
      .where(eq(schema.bundlePermissions.bundleId, bundleId))
    const before = {
      name: bundle.name,
      description: bundle.description,
      scope: bundle.scope,
      permissionIds: beforePerms.map((p) => p.permissionId),
    }

    await this.db.transaction(async (tx) => {
      if (Object.keys(fields).length > 0) {
        await tx
          .update(schema.permissionBundles)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(schema.permissionBundles.id, bundleId))
      }

      if (permissionIds !== undefined) {
        await tx
          .delete(schema.bundlePermissions)
          .where(eq(schema.bundlePermissions.bundleId, bundleId))

        if (permissionIds.length > 0) {
          await tx
            .insert(schema.bundlePermissions)
            .values(permissionIds.map((permissionId) => ({ bundleId, permissionId })))
        }
      }
    })

    if (permissionIds !== undefined) {
      // Invalidate cache for all users whose role uses this bundle
      await this.invalidateCacheForBundleUsers(bundleId)
    }

    return {
      id: bundleId,
      before,
      after: {
        name: fields.name ?? bundle.name,
        description: fields.description ?? bundle.description,
        scope: fields.scope ?? bundle.scope,
        permissionIds: permissionIds ?? before.permissionIds,
      },
    }
  }

  async deleteBundle(bundleId: string) {
    const bundle = await this.db.query.permissionBundles.findFirst({
      where: eq(schema.permissionBundles.id, bundleId),
    })

    if (!bundle) throw new Error('Bundle not found')
    if (bundle.isSystem) throw new Error('System bundles cannot be deleted')

    // Check if any roles are using this bundle
    const usages = await this.db
      .select()
      .from(schema.roleBundles)
      .where(eq(schema.roleBundles.bundleId, bundleId))
      .limit(1)

    if (usages.length > 0) {
      throw new Error('Bundle is in use by one or more roles. Remove it from those roles first.')
    }

    await this.db.delete(schema.permissionBundles).where(eq(schema.permissionBundles.id, bundleId))

    return { id: bundleId, name: bundle.name }
  }

  private async invalidateCacheForBundleUsers(bundleId: string) {
    // Get all roles that use this bundle
    const roles = await this.db
      .select({ roleId: schema.roleBundles.roleId })
      .from(schema.roleBundles)
      .where(eq(schema.roleBundles.bundleId, bundleId))

    // Invalidate cache for all users with those roles
    for (const { roleId } of roles) {
      await this.engine.invalidateCacheForRole(roleId)
    }
  }
}
