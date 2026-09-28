/**
 * PermissionEngine — core permission resolution
 *
 * This is the single authoritative place for permission decisions.
 * ALL permission checks go through here. No other code should implement
 * its own permission logic.
 *
 * Resolution order:
 *   1. Admin bypass — roleId === 'admin' → true, no DB query
 *   2. Cache lookup (KV, when wired up)
 *   3. BundleResolver → flat ResolvedPermission[]
 *   4. HierarchyResolver → expand with inherited child permissions
 *   5. Check if requested (module, action) is in the expanded set
 *   6. Cache the result
 */

import { ROLES } from '@denel/rbac'
import { and, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../../db/schema'
import { logError, logger } from '../../lib/logger'
import { groupPermissionsByModule, type ResolvedPermission } from '../utils/wildcardMatch'
import { type AppScope, resolveUserPermissions } from './BundleResolver'
import { CacheManager } from './CacheManager'
import { isModuleAccessible } from './HierarchyResolver'

type DB = NodePgDatabase<typeof schema>

export class PermissionEngine {
  private db: DB
  private cache: CacheManager

  constructor(db: DB) {
    this.db = db
    this.cache = new CacheManager()
  }

  /**
   * Primary check: can this user perform (action) on (module)?
   *
   * app (default 'portal') scopes the check to the requesting interface.
   * For PWA requests pass app='pwa'; the engine then uses PWA grants only
   * (pwa-scoped matrix rows, or 'pwa'/'all' bundles — never portal ones).
   *
   * ADMIN BYPASS LIVES HERE AND ONLY HERE.
   * Do not add admin checks anywhere else in the codebase.
   */
  async check(
    userId: string,
    module: string,
    action: string,
    app: AppScope = 'portal'
  ): Promise<boolean> {
    try {
      const user = await this.getUser(userId)
      if (!user) return false

      // ─── ADMIN BYPASS ───────────────────────────────────────────────────────
      // Admin has unconditional access to everything.
      //
      // `roleId` ONLY — never `user.role` (L11). `role` is the column Better
      // Auth's admin() plugin writes via `/api/auth/admin/set-role` and
      // `/admin/create-user`, both of which are mounted and reachable and
      // neither of which touches `roleId`. `roleId` is the FK into our RBAC
      // `roles` table that every other permission decision resolves from.
      //
      // The looser `|| user.role === 'admin'` form was removed from
      // `lib/rbac.isAdminUser` and `routes/auth.ts` as part of L11 and left
      // here — in the one place that actually ENFORCES. The result was a
      // ghost admin: setting someone's `role` through Better Auth, without
      // ever assigning them an RBAC role, granted unconditional access to
      // every module here while `/api/auth/permissions` reported
      // `isAdmin: false` and Access Management showed an ordinary role.
      //
      // Keep this in step with `isAdminUser()` in lib/rbac.ts. It is not
      // imported here because lib/rbac.ts imports this module.
      if (user.roleId === ROLES.ADMIN) return true
      // ────────────────────────────────────────────────────────────────────────

      // NOTE: role-specific rules do not belong here. Three of them used to —
      // receptionist labs create/update, receptionist blanket delete-deny, and
      // doctor labs read-only — and each was hand-copied into routes/auth.ts and
      // portals' useCan(), where the copies drifted apart. They now live in
      // bundles.config.ts: bundle_labs_coordinate (receptionist), bundle_labs_read
      // (doctor), and explicit action lists on bundle_clinical_full instead of
      // `:*`. Add grants there, not here.

      if (!user.roleId) {
        logger.warn(`[PermissionEngine] User ${userId} has no role assigned`)
        return false
      }

      const permissions = await this.resolvePermissions(userId, user.roleId, app)
      const allowed = isModuleAccessible(permissions, module, action)

      if (!allowed) {
        logger.warn(
          `[PermissionEngine] DENIED user=${userId} role=${user.roleId} ${module}:${action} app=${app}`
        )
      }

      return allowed
    } catch (err) {
      logError(err, { context: '[PermissionEngine] Error during permission check' })
      return false
    }
  }

  /**
   * Check if a user has access to a specific application scope (portal | pwa | hr).
   *
   * Resolution order:
   * 1. Per-user scope override (user_scopes table)
   * 2. Role-level scope grant (role_scopes table)
   *
   * NOTE: unlike `check()`, there is no admin bypass here. "Which apps may this
   * account enter" is a configurable fact, not a permission — and admin is
   * deliberately excluded from the Team app, which a bypass would silently undo.
   * The admin's own scope grants live in roles.config.ts like everyone else's.
   */
  async checkScope(userId: string, scope: 'portal' | 'pwa' | 'hr'): Promise<boolean> {
    try {
      const user = await this.getUser(userId)
      if (!user) return false

      // Per-user override takes precedence over role-level grant
      const userOverride = await this.db
        .select()
        .from(schema.userScopes)
        .where(
          and(eq(schema.userScopes.userId, userId), eq(schema.userScopes.interfaceScope, scope))
        )
        .limit(1)

      if (userOverride.length > 0) {
        return userOverride[0].granted
      }

      // Fall back to role-level scope grant
      if (!user.roleId) return false

      const roleScope = await this.db
        .select()
        .from(schema.roleScopes)
        .where(
          and(
            eq(schema.roleScopes.roleId, user.roleId),
            eq(schema.roleScopes.interfaceScope, scope)
          )
        )
        .limit(1)

      if (roleScope.length > 0) return true

      // Bootstrap failsafe — NOT a policy rule.
      //
      // Removing the admin bypass above means role_scopes is the only thing
      // granting admin entry anywhere. On a database where seed:rbac has never
      // run, admin has no rows at all, which would lock the only account that
      // can reach Access Management out of every app — an unrecoverable state
      // with no path back in. If an admin has NO scope rows whatsoever, let them
      // into the portal so they can fix it. An admin with any rows at all is
      // treated as configured, and this does not fire.
      if (user.roleId === 'admin' && scope === 'portal') {
        const anyAdminScope = await this.db
          .select({ interfaceScope: schema.roleScopes.interfaceScope })
          .from(schema.roleScopes)
          .where(eq(schema.roleScopes.roleId, 'admin'))
          .limit(1)

        if (anyAdminScope.length === 0) {
          logger.warn(
            '[PermissionEngine] admin has no role_scopes rows — granting portal via bootstrap failsafe. Run `pnpm --filter backend seed:rbac`.'
          )
          return true
        }
      }

      return false
    } catch (err) {
      logError(err, { context: '[PermissionEngine] Error during scope check' })
      return false
    }
  }

  /**
   * Get the full resolved permission set for a user — for API responses.
   * Returns grouped by module: { "patients": ["read", "create"], ... }
   * Pass app='pwa' to get PWA-scoped permissions (PWA grants only, no portal fallback).
   */
  async getPermissionMap(
    userId: string,
    roleId: string,
    app: AppScope = 'portal'
  ): Promise<Record<string, string[]>> {
    const permissions = await this.resolvePermissions(userId, roleId, app)
    return groupPermissionsByModule(permissions)
  }

  /**
   * Resolve and cache the flat permission list for a user.
   *
   * Cache key is per-user + scope so portal and PWA caches don't collide.
   */
  private async resolvePermissions(
    userId: string,
    roleId: string,
    app: AppScope = 'portal'
  ): Promise<ResolvedPermission[]> {
    // Key per surface. 'portal' keeps the bare userId for backwards
    // compatibility with entries already in the process cache; the others are
    // suffixed. Without the 'hr' suffix, an HR request and a portal request
    // would share one entry — harmless while hr resolves identically to portal,
    // but silently wrong the moment an hr-scoped bundle exists.
    const cacheKey = app === 'portal' ? userId : `${userId}:${app}`

    const cached = await this.cache.get(cacheKey)
    if (cached) return cached

    const permissions = await resolveUserPermissions(this.db, userId, roleId, app)

    await this.cache.set(cacheKey, permissions)

    return permissions
  }

  private async getUser(userId: string) {
    return this.db.query.user.findFirst({
      where: eq(schema.user.id, userId),
      columns: { id: true, roleId: true, role: true },
    })
  }

  /**
   * Invalidate cached permissions for a user.
   * Call this after role assignment changes or bundle modifications.
   */
  async invalidateCache(userId: string): Promise<void> {
    await this.cache.invalidate(userId)
  }

  /**
   * Invalidate cache for all users with a given role.
   * Call this when a role's bundle assignments change.
   */
  async invalidateCacheForRole(roleId: string): Promise<void> {
    const users = await this.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.roleId, roleId))

    await this.cache.invalidateByRole(users.map((u) => u.id))
  }
}
