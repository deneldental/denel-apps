/**
 * Config-derived RBAC tests.
 *
 * Why this file exists
 * --------------------
 * The previous suite (rbac-matrix.test.ts) tested the pure `can()` helper
 * against HAND-WRITTEN role fixtures. Those fixtures drifted from the real
 * config and nothing noticed: the suite asserted "doctor cannot DELETE
 * patients" and passed, while production granted `patients:*` to doctors and
 * the delete endpoint was live. It also could not have caught the Activity or
 * Services breakage.
 *
 * These tests resolve permissions from the ACTUAL config — SYSTEM_ROLES →
 * SYSTEM_BUNDLES → PERMISSION_DEFINITIONS — through the SAME pure functions the
 * runtime resolver uses (`expandPermissionString`, `expandWithHierarchy`,
 * `applicableBundleScopes`). Change a bundle and these tests move with it;
 * break the policy and they fail.
 *
 * What they cannot cover: anything requiring the database — per-user
 * `user_bundles`, matrix-mode `role_permissions`, bundle parent chains. Those
 * need the integration suite. Everything here is pure and runs without a DB.
 */

import { ROLE_SCOPES } from '@denel/rbac'
import { describe, expect, it } from 'vitest'
import { SYSTEM_BUNDLES } from '../../src/config/bundles.config'
import { PERMISSION_DEFINITIONS } from '../../src/config/permissions.config'
import { SYSTEM_ROLES } from '../../src/config/roles.config'
import { type AppScope, applicableBundleScopes } from '../../src/rbac/engine/BundleResolver'
import { expandWithHierarchy } from '../../src/rbac/engine/HierarchyResolver'
import {
  deduplicatePermissions,
  expandPermissionString,
  type ResolvedPermission,
} from '../../src/rbac/utils/wildcardMatch'

// ── Resolution, mirroring the runtime path ───────────────────────────────────

const bundleById = new Map(SYSTEM_BUNDLES.map((b) => [b.id, b]))
const roleById = new Map(SYSTEM_ROLES.map((r) => [r.id, r]))

/**
 * Resolve a system role's effective permissions for a surface, straight from
 * config. Uses `applicableBundleScopes` — the exported rule the resolver itself
 * calls — so the scope logic is never duplicated here.
 */
function resolve(roleId: string, scope: AppScope): ResolvedPermission[] {
  const role = roleById.get(roleId)
  if (!role) throw new Error(`Unknown role in test: ${roleId}`)

  const scopes = applicableBundleScopes(scope)
  const flat = role.bundleIds
    .map((id) => bundleById.get(id))
    .filter((b): b is NonNullable<typeof b> => !!b && scopes.includes(b.scope))
    .flatMap((b) => b.permissions)
    .flatMap(expandPermissionString)

  return expandWithHierarchy(deduplicatePermissions(flat))
}

function can(roleId: string, scope: AppScope, module: string, action: string): boolean {
  return resolve(roleId, scope).some((p) => p.module === module && p.action === action)
}

/** Actions a role holds on a module, sorted — for readable failure output. */
function actionsOn(roleId: string, scope: AppScope, module: string): string[] {
  return resolve(roleId, scope)
    .filter((p) => p.module === module)
    .map((p) => p.action)
    .sort()
}

// ── Config integrity ─────────────────────────────────────────────────────────
//
// These catch the class of bug where a route gates on something no bundle can
// grant — a typo, or a module that was never added to PERMISSION_DEFINITIONS.

describe('config integrity', () => {
  it('every bundle referenced by a role exists', () => {
    const missing: string[] = []
    for (const role of SYSTEM_ROLES) {
      for (const id of role.bundleIds) {
        if (!bundleById.has(id)) missing.push(`${role.id} → ${id}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('every permission string in every bundle expands to a real permission', () => {
    const unresolvable: string[] = []
    for (const bundle of SYSTEM_BUNDLES) {
      for (const perm of bundle.permissions) {
        if (expandPermissionString(perm).length === 0) {
          unresolvable.push(`${bundle.id} → ${perm}`)
        }
      }
    }
    expect(unresolvable).toEqual([])
  })

  it('no bundle grants an action outside create/read/update/delete', () => {
    const known = new Set(PERMISSION_DEFINITIONS.map((d) => `${d.module}:${d.action}`))
    const strays: string[] = []
    for (const bundle of SYSTEM_BUNDLES) {
      for (const { module, action } of bundle.permissions.flatMap(expandPermissionString)) {
        if (!known.has(`${module}:${action}`)) strays.push(`${bundle.id} → ${module}:${action}`)
      }
    }
    expect(strays).toEqual([])
  })

  it('every role declares at least one scope', () => {
    const scopeless = SYSTEM_ROLES.filter((r) => r.scopes.length === 0).map((r) => r.id)
    expect(scopeless).toEqual([])
  })

  it('a role holding the pwa scope resolves a non-empty pwa permission set', () => {
    // Guards the inheritance break: dropping portal from pwa resolution means a
    // pwa role whose bundles are all portal-scoped silently resolves to nothing.
    const empty = SYSTEM_ROLES.filter(
      (r) => r.id !== 'admin' && r.scopes.includes('pwa') && resolve(r.id, 'pwa').length === 0
    ).map((r) => r.id)
    expect(empty).toEqual([])
  })
})

// ── Interface scopes — which app each role may enter ─────────────────────────

describe('role → interface scopes', () => {
  const expected: Record<string, string[]> = {
    admin: ['portal', 'hr'],
    doctor: ['portal'],
    receptionist: ['portal', 'pwa'],
    lab_technician: ['pwa'],
    staff: ['pwa'],
    hr_admin: ['hr'],
    external_trainer: ['hr'],
  }

  for (const [roleId, scopes] of Object.entries(expected)) {
    it(`${roleId} holds exactly [${scopes.join(', ')}]`, () => {
      const role = roleById.get(roleId)
      expect(role, `role ${roleId} is missing from SYSTEM_ROLES`).toBeDefined()
      expect([...(role?.scopes ?? [])].sort()).toEqual([...scopes].sort())
    })
  }

  it('no role other than lab_technician, receptionist and staff can enter the Team app', () => {
    const withPwa = SYSTEM_ROLES.filter((r) => r.scopes.includes('pwa'))
      .map((r) => r.id)
      .sort()
    expect(withPwa).toEqual(['lab_technician', 'receptionist', 'staff'])
  })

  it('only doctor, receptionist and admin can enter the portal', () => {
    const withPortal = SYSTEM_ROLES.filter((r) => r.scopes.includes('portal'))
      .map((r) => r.id)
      .sort()
    expect(withPortal).toEqual(['admin', 'doctor', 'receptionist'])
  })

  it('the frontends see the same scopes (ROLE_SCOPES in @denel/rbac)', () => {
    // HR's onboarding screens tell the admin where a role signs in from
    // ROLE_SCOPES; a drift would have them promise access the role lacks.
    const fromConfig = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.id, [...r.scopes].sort()]))
    const shared = Object.fromEntries(
      Object.entries(ROLE_SCOPES).map(([id, scopes]) => [id, [...scopes].sort()])
    )
    expect(shared).toEqual(fromConfig)
  })
})

// ── Clinical record deletion ─────────────────────────────────────────────────

describe('clinical records cannot be deleted from the portal', () => {
  // The bug this locks down: bundle_clinical_full was `patients:*` … `xrays:*`,
  // and a hardcoded engine rule blocked receptionist deletes but never doctor
  // deletes — so doctors could delete patient records in production.
  for (const roleId of ['doctor', 'receptionist']) {
    for (const module of ['patients', 'medical_records', 'xrays']) {
      it(`${roleId} cannot delete ${module}`, () => {
        expect(can(roleId, 'portal', module, 'delete')).toBe(false)
      })
    }
  }

  it(`receptionist can still read, create and update patients`, () => {
    expect(actionsOn('receptionist', 'portal', 'patients')).toEqual(['create', 'read', 'update'])
  })

  it(`doctor can still read and update patients (no create)`, () => {
    expect(actionsOn('doctor', 'portal', 'patients')).toEqual(['read', 'update'])
  })
})

// ── Receptionist: the delete rule that used to be hardcoded ──────────────────

describe('receptionist deletes resolve from bundles, not a hardcoded rule', () => {
  // The engine used to deny receptionist EVERY delete, contradicting
  // bundle_inventory_full, which roles.config grants deliberately.
  for (const module of ['inventory', 'products', 'items']) {
    it(`can delete ${module} — stock correction is front-desk work`, () => {
      expect(can('receptionist', 'portal', module, 'delete')).toBe(true)
    })
  }

  it('can raise and update lab cases but not delete them', () => {
    expect(actionsOn('receptionist', 'portal', 'labs')).toEqual(['create', 'read', 'update'])
  })
})

// ── Doctor: labs is read-only, also formerly hardcoded ───────────────────────

describe('doctor labs access is read-only', () => {
  it('resolves exactly [read]', () => {
    expect(actionsOn('doctor', 'portal', 'labs')).toEqual(['read'])
  })
})

// ── The Team app is personal self-service, plus the lab bench ────────────────

describe('Team app grants', () => {
  it('receptionist gets self-service only — no front-desk work', () => {
    const perms = resolve('receptionist', 'pwa')
    const modules = [...new Set(perms.map((p) => p.module))].sort()
    expect(modules).toEqual(['dashboard', 'my_payslips', 'my_requests', 'my_training'])
  })

  it('no Team-app grant is an admin staff or payroll permission', () => {
    // The Team bundle used to gate its tabs on payroll:read and staff_* reads —
    // the very permissions /api/payroll, /api/staff and /api/hr check — so every
    // staff member could read everyone's pay, reviews and requests. Team tabs
    // gate on my_* now; admin modules must never resolve on the pwa surface.
    const ADMIN_STAFF = /^(payroll|staff|staff_requests|staff_training|staff_performance):/
    for (const bundle of SYSTEM_BUNDLES.filter((b) => b.scope === 'pwa')) {
      const leaked = bundle.permissions
        .flatMap(expandPermissionString)
        .map((p) => `${p.module}:${p.action}`)
        .filter((p) => ADMIN_STAFF.test(p))
      expect(leaked, `${bundle.id} grants admin staff/payroll access on the Team app`).toEqual([])
    }
    // Roles that can enter the Team app. external_trainer's training bundle is
    // scoped 'all', so it resolves on pwa too — but the role holds only the hr
    // scope, and the staff-administration APIs refuse Team-app sessions anyway.
    for (const role of SYSTEM_ROLES.filter((r) => r.scopes.includes('pwa'))) {
      const leaked = resolve(role.id, 'pwa')
        .map((p) => `${p.module}:${p.action}`)
        .filter((p) => ADMIN_STAFF.test(p))
      expect(leaked, `${role.id} resolves admin staff/payroll access on the Team app`).toEqual([])
    }
  })

  it('receptionist cannot reach patients or payments from a phone', () => {
    expect(can('receptionist', 'pwa', 'patients', 'read')).toBe(false)
    expect(can('receptionist', 'pwa', 'payments', 'create')).toBe(false)
  })

  it('lab_technician gets lab work only — they are not on payroll', () => {
    expect(actionsOn('lab_technician', 'pwa', 'labs')).toEqual(['read', 'update'])
    expect(can('lab_technician', 'pwa', 'payroll', 'read')).toBe(false)
  })

  it('staff get self-service including their own payslip', () => {
    expect(can('staff', 'pwa', 'my_payslips', 'read')).toBe(true)
    expect(can('staff', 'pwa', 'my_requests', 'read')).toBe(true)
    expect(can('staff', 'pwa', 'my_training', 'read')).toBe(true)
    expect(can('staff', 'pwa', 'payroll', 'read')).toBe(false)
    expect(can('staff', 'pwa', 'patients', 'read')).toBe(false)
  })

  it('the Team surface is never a superset of the portal one', () => {
    // The regression that made mobile the most permissive surface in the system.
    for (const role of SYSTEM_ROLES) {
      if (role.id === 'admin') continue
      const portal = new Set(resolve(role.id, 'portal').map((p) => `${p.module}:${p.action}`))
      const pwa = resolve(role.id, 'pwa').map((p) => `${p.module}:${p.action}`)
      const extra = pwa.filter((p) => !portal.has(p) && !p.startsWith('labs:'))
      // Self-service grants legitimately exist only on pwa; assert the clinical
      // and financial modules never leak there.
      const leaked = extra.filter((p) =>
        /^(patients|medical_records|xrays|payments|expenses|financial_records|compliance|insurance):/.test(
          p
        )
      )
      expect(leaked, `${role.id} leaks portal work onto the Team app`).toEqual([])
    }
  })
})

// ── HR ───────────────────────────────────────────────────────────────────────

describe('HR app grants', () => {
  it('hr_admin gets staff, payroll and tax — nothing clinical', () => {
    expect(can('hr_admin', 'hr', 'staff', 'read')).toBe(true)
    expect(can('hr_admin', 'hr', 'payroll', 'update')).toBe(true)
    expect(can('hr_admin', 'hr', 'tax_calculations', 'read')).toBe(true)
    expect(can('hr_admin', 'hr', 'patients', 'read')).toBe(false)
    expect(can('hr_admin', 'hr', 'payments', 'read')).toBe(false)
  })

  it('external_trainer gets training only — no staff or payroll visibility', () => {
    expect(can('external_trainer', 'hr', 'staff_training', 'read')).toBe(true)
    expect(can('external_trainer', 'hr', 'payroll', 'read')).toBe(false)
    expect(can('external_trainer', 'hr', 'staff', 'read')).toBe(false)
  })

  it("'hr' resolves a non-empty set for both HR roles", () => {
    // Guards the scope addition: hr inherits portal bundles today, so dropping
    // that inheritance without re-scoping the HR bundles would empty these out.
    expect(resolve('hr_admin', 'hr').length).toBeGreaterThan(0)
    expect(resolve('external_trainer', 'hr').length).toBeGreaterThan(0)
  })
})

// ── Least privilege spot-checks ──────────────────────────────────────────────

describe('least privilege', () => {
  const forbidden: Array<[string, string, string]> = [
    ['doctor', 'access_management', 'read'],
    ['doctor', 'staff', 'read'],
    ['doctor', 'settings', 'update'],
    ['doctor', 'users', 'read'],
    ['receptionist', 'access_management', 'read'],
    ['receptionist', 'staff', 'read'],
    ['receptionist', 'settings', 'update'],
    ['receptionist', 'users', 'read'],
    ['receptionist', 'payroll', 'update'],
  ]

  for (const [roleId, module, action] of forbidden) {
    it(`${roleId} cannot ${action} ${module}`, () => {
      expect(can(roleId, 'portal', module, action)).toBe(false)
    })
  }

  it('admin carries no bundles — access comes from the engine bypass', () => {
    expect(roleById.get('admin')?.bundleIds).toEqual([])
  })
})

// ── Estimates (decision D2, F02) ─────────────────────────────────────────────
//
// Doctors build, view and list estimates but hold NO payments permission:
// `payments:*` also opens payment history, the ledger and refunds, none of which
// a doctor needs to quote a treatment. `estimates` is its own module, and a child
// of `payments` and `financial_records` in the hierarchy, so every role that
// already holds payments access keeps estimates access without a single grant.

describe('estimates', () => {
  it('a doctor reads, creates and updates estimates', () => {
    expect(actionsOn('doctor', 'portal', 'estimates')).toEqual(['create', 'read', 'update'])
  })

  it('a receptionist does too', () => {
    expect(actionsOn('receptionist', 'portal', 'estimates')).toEqual(['create', 'read', 'update'])
  })

  it('a doctor still holds no payments permission of any kind', () => {
    expect(actionsOn('doctor', 'portal', 'payments')).toEqual([])
    expect(actionsOn('doctor', 'portal', 'financial_records')).toEqual([])
  })

  it('nobody is granted estimates:delete', () => {
    for (const role of SYSTEM_ROLES) {
      for (const scope of ['portal', 'pwa', 'hr'] as const) {
        expect(can(role.id, scope, 'estimates', 'delete'), `${role.id} on ${scope}`).toBe(false)
      }
    }
  })

  it('Team-app and HR roles hold no estimates access', () => {
    for (const [roleId, scope] of [
      ['staff', 'pwa'],
      ['lab_technician', 'pwa'],
      ['external_trainer', 'hr'],
      ['hr_admin', 'hr'],
    ] as const) {
      expect(actionsOn(roleId, scope, 'estimates'), `${roleId} on ${scope}`).toEqual([])
    }
  })

  describe('whoever already holds payments access keeps estimates access (hierarchy)', () => {
    const expand = (module: string, action: string) =>
      expandWithHierarchy([{ module, action }]).filter((p) => p.module === 'estimates')

    it.each(['read', 'create', 'update'])('payments:%s implies estimates:%s', (action) => {
      expect(expand('payments', action)).toEqual([{ module: 'estimates', action }])
    })

    it.each([
      'read',
      'create',
      'update',
    ])('financial_records:%s implies estimates:%s (the hierarchy is one level deep)', (action) => {
      expect(expand('financial_records', action)).toEqual([{ module: 'estimates', action }])
    })

    it('a role with only payments:read can therefore read estimates but not create them', () => {
      const held = expandWithHierarchy([{ module: 'payments', action: 'read' }])
      expect(held.some((p) => p.module === 'estimates' && p.action === 'read')).toBe(true)
      expect(held.some((p) => p.module === 'estimates' && p.action === 'create')).toBe(false)
    })
  })

  it('every estimates permission is defined, so a bundle can grant it', () => {
    const defined = PERMISSION_DEFINITIONS.filter((p) => p.module === 'estimates').map(
      (p) => p.action
    )
    expect(defined.sort()).toEqual(['create', 'read', 'update'])
  })
})
