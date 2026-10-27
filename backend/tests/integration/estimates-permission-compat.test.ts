/**
 * D2 — adding the `estimates` permission must not take estimates away from anyone who
 * could already use them, and must not hand a doctor anything to do with payments.
 *
 * Before this, every estimate endpoint sat behind `payments:*`. So any role built on a
 * payments or finance bundle can use estimates today, and has to keep doing so: the
 * hierarchy makes `payments` and `financial_records` imply `estimates`. This resolves
 * real roles against the real seeded bundles (the same resolver the permission engine
 * uses), inside a transaction that is rolled back.
 *
 * Needs the RBAC seed (`pnpm --filter backend seed:rbac`, run by `db:local:setup`).
 */
import { describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { resolveRolePermissions } from '../../src/rbac/engine/BundleResolver'
import { noDb, withRollback } from './_setup'

async function resolve(bundleIds: string[]) {
  return withRollback(async (tx) => {
    const roleId = '__test_estimates_compat__'
    await tx.insert(schema.roles).values({
      id: roleId,
      name: roleId,
      description: 'transient test role — rolled back',
      isSystem: false,
    })
    await tx.insert(schema.roleBundles).values(bundleIds.map((bundleId) => ({ roleId, bundleId })))
    return resolveRolePermissions(tx, roleId)
  })
}

const has = (perms: Array<{ module: string; action: string }>, module: string, action: string) =>
  perms.some((p) => p.module === module && p.action === action)

describe.skipIf(noDb)('estimates permission — who gets it', () => {
  it('a role built on the payments bundle keeps estimates (read, create, update)', async () => {
    const perms = await resolve(['bundle_payments_only'])
    for (const action of ['read', 'create', 'update']) {
      expect(has(perms, 'estimates', action), `payments → estimates:${action}`).toBe(true)
    }
  })

  it('a finance read-only role can read estimates and cannot create them', async () => {
    const perms = await resolve(['bundle_financial_read'])
    expect(has(perms, 'estimates', 'read')).toBe(true)
    expect(has(perms, 'estimates', 'create')).toBe(false)
    expect(has(perms, 'estimates', 'update')).toBe(false)
  })

  it('a finance full-access role keeps all of it (via financial_records)', async () => {
    const perms = await resolve(['bundle_financial_full'])
    for (const action of ['read', 'create', 'update']) {
      expect(has(perms, 'estimates', action), `finance → estimates:${action}`).toBe(true)
    }
  })

  it('the estimates bundle alone grants estimates and nothing about payments or finance', async () => {
    const perms = await resolve(['bundle_estimates_manage'])
    for (const action of ['read', 'create', 'update']) {
      expect(has(perms, 'estimates', action), `estimates:${action}`).toBe(true)
    }
    expect(has(perms, 'estimates', 'delete')).toBe(false)
    for (const forbidden of [
      'payments',
      'financial_records',
      'ledger_adjustments',
      'credit_notes',
    ]) {
      expect(
        perms.filter((p) => p.module === forbidden),
        `${forbidden} must not come with the estimates bundle`
      ).toEqual([])
    }
  })

  it('a doctor’s whole role has estimates and no payment access', async () => {
    // The doctor role's bundles, resolved from the seed (not copied here), so a change
    // to roles.config.ts that hands a doctor payments fails this test.
    const doctorBundles = await withRollback(async (tx) => {
      const rows = await tx.select().from(schema.roleBundles)
      return rows.filter((r) => r.roleId === 'doctor').map((r) => r.bundleId)
    })
    expect(doctorBundles).toContain('bundle_estimates_manage')

    const perms = await resolve(doctorBundles)
    for (const action of ['read', 'create', 'update']) {
      expect(has(perms, 'estimates', action), `doctor estimates:${action}`).toBe(true)
    }
    for (const forbidden of ['payments', 'financial_records', 'expenses', 'journal_entries']) {
      expect(
        perms.filter((p) => p.module === forbidden),
        `a doctor must hold no ${forbidden}`
      ).toEqual([])
    }
  })
})
