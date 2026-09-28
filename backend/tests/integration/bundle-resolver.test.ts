/**
 * Regression test for BundleResolver — a role with 2+ bundles must resolve its
 * permissions without throwing.
 *
 * Bug: `resolveFromBundles` used `(column as any).in(bundleIds)` for the
 * multi-bundle branch. `.in()` is not a Drizzle column method, so resolution
 * threw `TypeError: ...in is not a function` for every role with >1 bundle
 * (doctor, receptionist, and every realistic custom role). Single-bundle roles
 * took the working `eq()` branch and were unaffected — which is why the bug
 * stayed hidden until a multi-bundle role was exercised.
 */

import { describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { resolveRolePermissions } from '../../src/rbac/engine/BundleResolver'
import { noDb, withRollback } from './_setup'

describe.skipIf(noDb)('BundleResolver — multi-bundle role resolution', () => {
  it('resolves permissions for a role with two bundles without throwing', async () => {
    const result = await withRollback(async (tx) => {
      // A custom role wired to two seeded system bundles:
      //   bundle_dashboard      → dashboard:read
      //   bundle_payments_only  → payments:read, payments:create
      const roleId = '__test_multibundle_role__'
      await tx.insert(schema.roles).values({
        id: roleId,
        name: '__test_multibundle_role__',
        description: 'transient test role — rolled back',
        isSystem: false,
      })
      await tx.insert(schema.roleBundles).values([
        { roleId, bundleId: 'bundle_dashboard' },
        { roleId, bundleId: 'bundle_payments_only' },
      ])

      return resolveRolePermissions(tx, roleId)
    })

    // Must not throw, and must contain the union of both bundles' permissions.
    expect(result.some((p) => p.module === 'dashboard' && p.action === 'read')).toBe(true)
    expect(result.some((p) => p.module === 'payments' && p.action === 'read')).toBe(true)
    expect(result.some((p) => p.module === 'payments' && p.action === 'create')).toBe(true)
  })

  it('resolves a single-bundle role too (the eq() branch — already worked)', async () => {
    const result = await withRollback(async (tx) => {
      const roleId = '__test_singlebundle_role__'
      await tx.insert(schema.roles).values({
        id: roleId,
        name: '__test_singlebundle_role__',
        description: 'transient test role — rolled back',
        isSystem: false,
      })
      await tx.insert(schema.roleBundles).values({ roleId, bundleId: 'bundle_dashboard' })

      return resolveRolePermissions(tx, roleId)
    })

    expect(result.some((p) => p.module === 'dashboard' && p.action === 'read')).toBe(true)
  })
})
