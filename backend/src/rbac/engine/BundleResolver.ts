/**
 * BundleResolver — resolves a role's bundles into a flat permission set
 *
 * Resolution chain:
 *   role → role_bundles → permission_bundles → bundle_permissions → permissions
 *
 * Phase 3.1: legacy role_permissions fallback removed. All roles must have
 * bundles assigned (run src/scripts/migrate-rbac-to-bundles.ts first).
 * Roles with no bundles resolve to zero permissions (fail-closed).
 */

import { and, eq, inArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../../db/schema'
import { logger } from '../../lib/logger'
import { deduplicatePermissions, type ResolvedPermission } from '../utils/wildcardMatch'
import { expandWithHierarchy } from './HierarchyResolver'

/**
 * Resolve a role's direct permissions from the role_permissions table (matrix
 * mode). Returns null when the role has no direct rows for the given scope,
 * signalling that the caller should fall back to bundles.
 */
async function resolveMatrixPermissions(
  db: DB,
  roleId: string,
  scope: AppScope = 'portal'
): Promise<ResolvedPermission[] | null> {
  const rows = await db
    .select({ module: schema.permissions.module, action: schema.permissions.action })
    .from(schema.rolePermissions)
    .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
    .where(and(eq(schema.rolePermissions.roleId, roleId), eq(schema.rolePermissions.scope, scope)))

  if (rows.length === 0) return null

  const flat = deduplicatePermissions(rows.map((r) => ({ module: r.module, action: r.action })))
  return expandWithHierarchy(flat)
}

type DB = NodePgDatabase<typeof schema>

/** The interface surfaces a permission set can be resolved for. */
export type AppScope = 'portal' | 'pwa' | 'hr'

/**
 * Which bundle scopes apply when resolving for a given surface. Exported so
 * tests assert against the real rule rather than a copy of it.
 *
 *   portal → 'portal' + 'all'
 *   pwa    → 'pwa' + 'all'          — deliberately NOT 'portal', see below
 *   hr     → 'hr' + 'portal' + 'all'
 *
 * pwa does not inherit portal. It used to, on an "inherit until customised"
 * rationale — but 33 of 36 bundles are portal-scoped, so the mobile surface
 * resolved as a strict SUPERSET of the desktop one for every role holding both
 * scopes. A doctor on a personal phone got full clinical CRUD, payments,
 * compliance and analytics; the only way to narrow it was a pwa matrix
 * override, which discards every bundle for that role (all-or-nothing). The
 * Team app is personal self-service plus the lab bench, so what reaches it is
 * exactly the pwa-scoped bundles.
 *
 * hr DOES still inherit portal, because every bundle the HR roles hold
 * (staff_full, payroll_full, tax_calculations) is portal-scoped today —
 * dropping the inheritance would resolve hr_admin to nothing. Keeping it means
 * 'hr' is a real scope with no behaviour change: HR-only bundles can now be
 * authored and will resolve only in HR. Narrowing hr below portal needs the
 * per-domain model in v3; it is not expressible here.
 */
export function applicableBundleScopes(scope: AppScope): string[] {
  if (scope === 'pwa') return ['pwa', 'all']
  if (scope === 'hr') return ['hr', 'portal', 'all']
  return ['portal', 'all']
}

/**
 * Resolve all permissions for a given roleId.
 *
 * scope='portal' (default):
 *   Matrix mode (role_permissions WHERE scope='portal' rows present): uses those directly.
 *   Bundle mode (no matrix rows): resolves from assigned bundles (scope='portal'|'all').
 *   Roles with neither resolve to zero permissions (fail-closed).
 *
 * scope='pwa':
 *   Matrix mode (role_permissions WHERE scope='pwa' rows present): uses those directly.
 *   Bundle mode (no pwa matrix rows): resolves from bundles scoped 'pwa'|'all' only —
 *   pwa does NOT inherit portal bundles (see applicableBundleScopes()).
 */
export async function resolveRolePermissions(
  db: DB,
  roleId: string,
  scope: AppScope = 'portal'
): Promise<ResolvedPermission[]> {
  const matrix = await resolveMatrixPermissions(db, roleId, scope)

  if (matrix !== null) return matrix

  // No explicit matrix rows for this scope — resolve from assigned bundles.
  // See applicableBundleScopes() for which scopes apply per surface and why.
  //
  // Practical effect per role: receptionist and staff resolve
  // bundle_pwa_standard on 'pwa'; lab_technician resolves
  // bundle_pwa_lab_technician; doctor, admin and hr_admin hold no 'pwa' scope
  // at all.
  const applicableScopes = applicableBundleScopes(scope)

  const roleBundleRows = await db
    .select({ bundleId: schema.roleBundles.bundleId, bundleScope: schema.permissionBundles.scope })
    .from(schema.roleBundles)
    .innerJoin(
      schema.permissionBundles,
      eq(schema.roleBundles.bundleId, schema.permissionBundles.id)
    )
    .where(eq(schema.roleBundles.roleId, roleId))

  const applicableBundles = roleBundleRows
    .filter((r) => applicableScopes.includes(r.bundleScope))
    .map((r) => r.bundleId)

  if (applicableBundles.length === 0) {
    logger.warn(
      `[BundleResolver] Role "${roleId}" has no bundles or matrix permissions assigned for scope "${scope}" — resolves to zero permissions.`
    )
    return []
  }

  return resolveFromBundles(db, applicableBundles)
}

/**
 * Resolve permissions for a user.
 *
 * scope (default 'portal') controls which surface's grants are returned —
 * the role's grants for that surface (see resolveRolePermissions) plus the
 * user's own bundles (user_bundles) that apply to the same surface.
 *
 * Per-user bundles follow the SAME surface rule as role bundles
 * (applicableBundleScopes). They used to be merged whatever their scope, so
 * the pwa-scoped `bundle_pwa_standard` that HR auto-grants to every staff
 * member also counted in the portal — handing Team-app grants such as
 * payroll:read to portal requests.
 */
export async function resolveUserPermissions(
  db: DB,
  userId: string,
  roleId: string | null,
  scope: AppScope = 'portal'
): Promise<ResolvedPermission[]> {
  const [basePerms, userBundleRows] = await Promise.all([
    roleId ? resolveRolePermissions(db, roleId, scope) : Promise.resolve([]),
    db
      .select({
        bundleId: schema.userBundles.bundleId,
        bundleScope: schema.permissionBundles.scope,
      })
      .from(schema.userBundles)
      .innerJoin(
        schema.permissionBundles,
        eq(schema.userBundles.bundleId, schema.permissionBundles.id)
      )
      .where(eq(schema.userBundles.userId, userId)),
  ])

  const applicableScopes = applicableBundleScopes(scope)
  const applicableUserBundles = userBundleRows
    .filter((r) => applicableScopes.includes(r.bundleScope))
    .map((r) => r.bundleId)

  if (applicableUserBundles.length === 0) return basePerms

  // Merge per-user bundle additions on top of the role baseline
  const userBundlePerms = await resolveFromBundles(db, applicableUserBundles)
  const merged = deduplicatePermissions([...basePerms, ...userBundlePerms])
  return expandWithHierarchy(merged)
}

async function resolveFromBundles(db: DB, bundleIds: string[]): Promise<ResolvedPermission[]> {
  if (bundleIds.length === 0) return []

  // Phase 4B — expand bundle composition. For every bundle in scope, walk
  // its parent chain and add the parents' permissions to the resolved set.
  // Cycle detection via `visited`; depth-capped to avoid pathological data.
  const expanded = await expandBundleParents(db, bundleIds)

  // Load all bundle_permissions for the expanded set
  const rows = await db
    .select({
      module: schema.permissions.module,
      action: schema.permissions.action,
    })
    .from(schema.bundlePermissions)
    .innerJoin(schema.permissions, eq(schema.bundlePermissions.permissionId, schema.permissions.id))
    .where(
      expanded.length === 1
        ? eq(schema.bundlePermissions.bundleId, expanded[0])
        : inArray(schema.bundlePermissions.bundleId, expanded)
    )

  const flat = deduplicatePermissions(rows.map((r) => ({ module: r.module, action: r.action })))

  return expandWithHierarchy(flat)
}

/**
 * Walk `parentBundleId` chains and collect every transitive ancestor. The
 * input list is included in the output. Depth-capped at 20 to short-circuit
 * any data corruption that slips past the cycle guard.
 */
async function expandBundleParents(db: DB, bundleIds: string[]): Promise<string[]> {
  const visited = new Set<string>(bundleIds)
  let frontier = bundleIds
  for (let depth = 0; depth < 20 && frontier.length > 0; depth++) {
    const parents = await db
      .select({
        id: schema.permissionBundles.id,
        parentBundleId: schema.permissionBundles.parentBundleId,
      })
      .from(schema.permissionBundles)
      .where(
        frontier.length === 1
          ? eq(schema.permissionBundles.id, frontier[0])
          : inArray(schema.permissionBundles.id, frontier)
      )
    const nextFrontier: string[] = []
    for (const row of parents) {
      if (row.parentBundleId && !visited.has(row.parentBundleId)) {
        visited.add(row.parentBundleId)
        nextFrontier.push(row.parentBundleId)
      }
    }
    if (nextFrontier.length === 0) break
    frontier = nextFrontier
  }
  return Array.from(visited)
}

/**
 * Resolve the raw bundle list (with names) for a role — used in API responses.
 */
export async function getRoleBundleNames(db: DB, roleId: string): Promise<string[]> {
  const rows = await db
    .select({ name: schema.permissionBundles.name })
    .from(schema.roleBundles)
    .innerJoin(
      schema.permissionBundles,
      eq(schema.roleBundles.bundleId, schema.permissionBundles.id)
    )
    .where(eq(schema.roleBundles.roleId, roleId))

  return rows.map((r) => r.name)
}
