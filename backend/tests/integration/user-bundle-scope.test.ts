/**
 * Per-user bundles follow the same surface rule as role bundles.
 *
 * Bug: `resolveUserPermissions` merged every `user_bundles` grant whatever the
 * bundle's scope, so the pwa-scoped bundle HR auto-grants to each staff member
 * also counted in the portal and in HR — handing Team-app grants such as
 * payroll:read to portal requests. User bundles now go through
 * `applicableBundleScopes()` exactly like role bundles:
 *
 *   portal → portal + all      pwa → pwa + all      hr → hr + portal + all
 *
 * The bundles here are transient (one seeded permission each, so the assertions
 * can tell them apart) and everything is rolled back.
 */

import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { resolveUserPermissions } from '../../src/rbac/engine/BundleResolver'
import type { ResolvedPermission } from '../../src/rbac/utils/wildcardMatch'
import { noDb, withRollback } from './_setup'

const has = (perms: ResolvedPermission[], module: string, action: string) =>
  perms.some((p) => p.module === module && p.action === action)

describe.skipIf(noDb)('BundleResolver — per-user bundles respect the surface scope', () => {
  it('applies a user bundle only on the surfaces its scope covers', async () => {
    const result = await withRollback(async (tx) => {
      const permissionId = async (module: string, action: string) => {
        const [row] = await tx
          .select({ id: schema.permissions.id })
          .from(schema.permissions)
          .where(and(eq(schema.permissions.module, module), eq(schema.permissions.action, action)))
        if (!row) throw new Error(`seeded permission ${module}:${action} is missing`)
        return row.id
      }

      const now = new Date()
      const userId = '__test_user_bundle_scope__'
      await tx.insert(schema.user).values({
        id: userId,
        name: 'User-bundle scope test',
        email: '__user_bundle_scope__@example.invalid',
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      })

      const bundles = [
        { id: '__test_ub_pwa__', scope: 'pwa', permission: await permissionId('payroll', 'read') },
        {
          id: '__test_ub_portal__',
          scope: 'portal',
          permission: await permissionId('payments', 'read'),
        },
        {
          id: '__test_ub_all__',
          scope: 'all',
          permission: await permissionId('dashboard', 'read'),
        },
        { id: '__test_ub_hr__', scope: 'hr', permission: await permissionId('staff', 'read') },
      ]
      for (const b of bundles) {
        await tx
          .insert(schema.permissionBundles)
          .values({ id: b.id, name: b.id, scope: b.scope, isSystem: false })
        await tx
          .insert(schema.bundlePermissions)
          .values({ bundleId: b.id, permissionId: b.permission })
        await tx.insert(schema.userBundles).values({ userId, bundleId: b.id })
      }

      // No role: only the user's own bundles contribute.
      return {
        portal: await resolveUserPermissions(tx, userId, null, 'portal'),
        pwa: await resolveUserPermissions(tx, userId, null, 'pwa'),
        hr: await resolveUserPermissions(tx, userId, null, 'hr'),
      }
    })

    // portal → portal + all
    expect(has(result.portal, 'payments', 'read')).toBe(true)
    expect(has(result.portal, 'dashboard', 'read')).toBe(true)
    expect(has(result.portal, 'payroll', 'read')).toBe(false)
    expect(has(result.portal, 'staff', 'read')).toBe(false)

    // pwa → pwa + all
    expect(has(result.pwa, 'payroll', 'read')).toBe(true)
    expect(has(result.pwa, 'dashboard', 'read')).toBe(true)
    expect(has(result.pwa, 'payments', 'read')).toBe(false)
    expect(has(result.pwa, 'staff', 'read')).toBe(false)

    // hr → hr + portal + all
    expect(has(result.hr, 'staff', 'read')).toBe(true)
    expect(has(result.hr, 'payments', 'read')).toBe(true)
    expect(has(result.hr, 'dashboard', 'read')).toBe(true)
    expect(has(result.hr, 'payroll', 'read')).toBe(false)
  })

  it("keeps the role's grants when none of the user's bundles apply", async () => {
    const result = await withRollback(async (tx) => {
      const now = new Date()
      const userId = '__test_user_bundle_scope_role__'
      await tx.insert(schema.user).values({
        id: userId,
        name: 'User-bundle scope test (role)',
        email: '__user_bundle_scope_role__@example.invalid',
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(schema.permissionBundles).values({
        id: '__test_ub_pwa_only__',
        name: '__test_ub_pwa_only__',
        scope: 'pwa',
        isSystem: false,
      })
      await tx.insert(schema.userBundles).values({ userId, bundleId: '__test_ub_pwa_only__' })

      // The seeded receptionist role resolves portal grants from its bundles.
      return resolveUserPermissions(tx, userId, 'receptionist', 'portal')
    })

    expect(has(result, 'patients', 'read')).toBe(true)
    expect(has(result, 'appointments', 'read')).toBe(true)
  })
})
