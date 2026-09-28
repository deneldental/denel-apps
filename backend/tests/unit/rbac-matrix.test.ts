/**
 * Unit tests for @denel/rbac — the `can()` function and module hierarchy.
 *
 * Why these tests matter:
 *   1. `can()` is the frontend's last line of defence for UI gating. A bug
 *      here could expose sensitive sections to the wrong role.
 *   2. The MODULE_HIERARCHY is the single source of truth for which child
 *      permissions are implied by a parent grant. A regression here silently
 *      breaks permission checks across ALL apps.
 *   3. No RBAC matrix test existed before this file (audit finding: testing
 *      dimension — "no test verifies that ROLES.DOCTOR cannot call
 *      ACTIONS.MANAGE_STAFF").
 *
 * Test strategy:
 *   - Pure unit tests against the @denel/rbac package (no Hono, no DB).
 *   - Role fixtures mirror expected production permissions from roles.config.ts.
 *   - Hierarchy expansion tests verify that granting a parent module implicitly
 *     grants the same action on each child module.
 */

import {
  ACTIONS,
  can,
  getChildModules,
  getParentModule,
  isChildModule,
  isParentModule,
  MODULE_HIERARCHY,
  MODULES,
  ROLES,
  type UserWithRole,
} from '@denel/rbac'
import { describe, expect, it } from 'vitest'

// ── Fixtures ─────────────────────────────────────────────────────────────────
//
// These are ARBITRARY permission sets for exercising can() and the hierarchy
// helpers — they do not describe real roles. Assertions about what a doctor or
// receptionist can actually do belong in rbac-config.test.ts, which resolves
// them from bundles.config.ts. Fixtures here once claimed to mirror production
// and drifted, asserting that doctors could not delete patients while the real
// config granted exactly that.

const adminUser: UserWithRole = {
  id: 'u-admin',
  role: ROLES.ADMIN,
  permissions: [], // admin bypasses permission check
}

// User with only a parent module grant (no explicit child grants)
const userWithParentPatients: UserWithRole = {
  id: 'u-parent-patients',
  role: ROLES.RECEPTIONIST,
  permissions: [{ module: MODULES.PATIENTS, action: ACTIONS.READ }],
}

const userWithParentFinancial: UserWithRole = {
  id: 'u-parent-financial',
  role: ROLES.RECEPTIONIST,
  permissions: [{ module: MODULES.FINANCIAL_RECORDS, action: ACTIONS.READ }],
}

const userWithParentSettings: UserWithRole = {
  id: 'u-parent-settings',
  role: ROLES.ADMIN,
  permissions: [{ module: MODULES.SETTINGS, action: ACTIONS.READ }],
}

// ── Anonymous user tests ───────────────────────────────────────────────────────

describe('can() — anonymous / unauthenticated user', () => {
  it('returns false for null', () => {
    expect(can(null, MODULES.PATIENTS, ACTIONS.READ)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(can(undefined, MODULES.PATIENTS, ACTIONS.READ)).toBe(false)
  })

  it('returns false for any module/action combination', () => {
    const combos = [
      [MODULES.PATIENTS, ACTIONS.READ],
      [MODULES.PAYMENTS, ACTIONS.CREATE],
      [MODULES.ACCESS_MANAGEMENT, ACTIONS.UPDATE],
      [MODULES.STAFF, ACTIONS.DELETE],
      [MODULES.ANALYTICS, ACTIONS.READ],
    ] as const

    for (const [mod, action] of combos) {
      expect(can(null, mod, action), `null should not have ${mod}:${action}`).toBe(false)
    }
  })
})

// ── Admin bypass ──────────────────────────────────────────────────────────────

describe('can() — admin role bypass', () => {
  it('admin with empty permissions can do everything', () => {
    const allModules = Object.values(MODULES)
    const allActions = Object.values(ACTIONS)

    for (const mod of allModules) {
      for (const action of allActions) {
        expect(can(adminUser, mod, action), `admin should be able to ${action} ${mod}`).toBe(true)
      }
    }
  })

  it('admin role check is case-sensitive — "Admin" (capital A) does not bypass', () => {
    const fakeAdmin: UserWithRole = {
      id: 'u-fake',
      role: 'Admin', // uppercase — not a valid role string
      permissions: [],
    }
    // "Admin" !== "admin" so the bypass should not apply
    expect(can(fakeAdmin, MODULES.PATIENTS, ACTIONS.READ)).toBe(false)
  })
})

// ── Doctor permissions ────────────────────────────────────────────────────────

describe('can() — PATIENTS module hierarchy expansion', () => {
  it('user with PATIENTS:read also has MEDICAL_RECORDS:read (via hierarchy)', () => {
    expect(can(userWithParentPatients, MODULES.MEDICAL_RECORDS, ACTIONS.READ)).toBe(true)
  })

  it('user with PATIENTS:read also has ORTHO_CONSENT:read (via hierarchy)', () => {
    expect(can(userWithParentPatients, MODULES.ORTHO_CONSENT, ACTIONS.READ)).toBe(true)
  })

  it('user with PATIENTS:read also has INSURANCE:read (via hierarchy)', () => {
    expect(can(userWithParentPatients, MODULES.INSURANCE, ACTIONS.READ)).toBe(true)
  })

  it('user with PATIENTS:read also has XRAYS:read (via hierarchy)', () => {
    expect(can(userWithParentPatients, MODULES.XRAYS, ACTIONS.READ)).toBe(true)
  })

  it('hierarchy does NOT grant a different action on child (PATIENTS:read ≠ MEDICAL_RECORDS:create)', () => {
    expect(can(userWithParentPatients, MODULES.MEDICAL_RECORDS, ACTIONS.CREATE)).toBe(false)
  })

  it('hierarchy does NOT propagate to unrelated modules', () => {
    expect(can(userWithParentPatients, MODULES.PAYMENTS, ACTIONS.READ)).toBe(false)
    expect(can(userWithParentPatients, MODULES.STAFF, ACTIONS.READ)).toBe(false)
  })
})

describe('can() — FINANCIAL_RECORDS module hierarchy expansion', () => {
  it('user with FINANCIAL_RECORDS:read also has PAYMENTS:read', () => {
    expect(can(userWithParentFinancial, MODULES.PAYMENTS, ACTIONS.READ)).toBe(true)
  })

  it('user with FINANCIAL_RECORDS:read also has EXPENSES:read', () => {
    expect(can(userWithParentFinancial, MODULES.EXPENSES, ACTIONS.READ)).toBe(true)
  })

  it('user with FINANCIAL_RECORDS:read also has BILLS:read', () => {
    expect(can(userWithParentFinancial, MODULES.BILLS, ACTIONS.READ)).toBe(true)
  })

  it('user with FINANCIAL_RECORDS:read also has CREDIT_NOTES:read', () => {
    expect(can(userWithParentFinancial, MODULES.CREDIT_NOTES, ACTIONS.READ)).toBe(true)
  })

  it('user with FINANCIAL_RECORDS:read also has JOURNAL_ENTRIES:read', () => {
    expect(can(userWithParentFinancial, MODULES.JOURNAL_ENTRIES, ACTIONS.READ)).toBe(true)
  })

  it('hierarchy does NOT grant FINANCIAL_RECORDS:create to child PAYMENTS:create', () => {
    // Only READ was granted on the parent — CREATE on child is not implied
    expect(can(userWithParentFinancial, MODULES.PAYMENTS, ACTIONS.CREATE)).toBe(false)
  })
})

describe('can() — SETTINGS module hierarchy expansion', () => {
  it('user with SETTINGS:read also has USERS:read', () => {
    expect(can(userWithParentSettings, MODULES.USERS, ACTIONS.READ)).toBe(true)
  })

  it('user with SETTINGS:read also has AUDIT_LOGS:read', () => {
    expect(can(userWithParentSettings, MODULES.AUDIT_LOGS, ACTIONS.READ)).toBe(true)
  })

  it('user with SETTINGS:read also has INTEGRATIONS:read', () => {
    expect(can(userWithParentSettings, MODULES.INTEGRATIONS, ACTIONS.READ)).toBe(true)
  })
})

// ── Multiple permissions ───────────────────────────────────────────────────────

describe('can() — user with multiple explicit permissions', () => {
  const multiPermUser: UserWithRole = {
    id: 'u-multi',
    role: ROLES.RECEPTIONIST,
    permissions: [
      { module: MODULES.PATIENTS, action: ACTIONS.READ },
      { module: MODULES.PAYMENTS, action: ACTIONS.CREATE },
      { module: MODULES.APPOINTMENTS, action: ACTIONS.READ },
    ],
  }

  it('can do all explicitly granted things', () => {
    expect(can(multiPermUser, MODULES.PATIENTS, ACTIONS.READ)).toBe(true)
    expect(can(multiPermUser, MODULES.PAYMENTS, ACTIONS.CREATE)).toBe(true)
    expect(can(multiPermUser, MODULES.APPOINTMENTS, ACTIONS.READ)).toBe(true)
  })

  it('cannot do things not in the permission list', () => {
    expect(can(multiPermUser, MODULES.PATIENTS, ACTIONS.DELETE)).toBe(false)
    expect(can(multiPermUser, MODULES.ANALYTICS, ACTIONS.READ)).toBe(false)
    expect(can(multiPermUser, MODULES.STAFF, ACTIONS.READ)).toBe(false)
  })

  it('hierarchy still works alongside explicit grants', () => {
    // PATIENTS:read is in the list → MEDICAL_RECORDS:read is implied by hierarchy
    expect(can(multiPermUser, MODULES.MEDICAL_RECORDS, ACTIONS.READ)).toBe(true)
    // But MEDICAL_RECORDS:create is still not available
    expect(can(multiPermUser, MODULES.MEDICAL_RECORDS, ACTIONS.CREATE)).toBe(false)
  })
})

// ── Helper function tests ──────────────────────────────────────────────────────

describe('isParentModule()', () => {
  it('returns true for each key in MODULE_HIERARCHY', () => {
    for (const mod of Object.keys(MODULE_HIERARCHY)) {
      expect(isParentModule(mod), `${mod} should be a parent`).toBe(true)
    }
  })

  it('returns false for a leaf/child module', () => {
    expect(isParentModule(MODULES.MEDICAL_RECORDS)).toBe(false)
    expect(isParentModule(MODULES.PAYMENTS)).toBe(false)
    expect(isParentModule(MODULES.XRAYS)).toBe(false)
  })

  it('returns false for an unknown module', () => {
    expect(isParentModule('nonexistent_module')).toBe(false)
  })
})

describe('getChildModules()', () => {
  it('returns all PATIENTS children', () => {
    const children = getChildModules(MODULES.PATIENTS)
    expect(children).toContain(MODULES.MEDICAL_RECORDS)
    expect(children).toContain(MODULES.ORTHO_CONSENT)
    expect(children).toContain(MODULES.INSURANCE)
    expect(children).toContain(MODULES.XRAYS)
  })

  it('returns all FINANCIAL_RECORDS children', () => {
    const children = getChildModules(MODULES.FINANCIAL_RECORDS)
    expect(children).toContain(MODULES.PAYMENTS)
    expect(children).toContain(MODULES.EXPENSES)
    expect(children).toContain(MODULES.BILLS)
    expect(children).toContain(MODULES.CREDIT_NOTES)
  })

  it('returns [] for a leaf module', () => {
    expect(getChildModules(MODULES.MEDICAL_RECORDS)).toEqual([])
    expect(getChildModules(MODULES.PAYMENTS)).toEqual([])
  })

  it('returns [] for an unknown module', () => {
    expect(getChildModules('nonexistent')).toEqual([])
  })
})

describe('isChildModule()', () => {
  it('returns true for each child of PATIENTS', () => {
    const children = MODULE_HIERARCHY[MODULES.PATIENTS].children
    for (const child of children) {
      expect(isChildModule(child), `${child} should be a child`).toBe(true)
    }
  })

  it('returns false for parent modules', () => {
    for (const parent of Object.keys(MODULE_HIERARCHY)) {
      // A parent module is not itself a child (flat hierarchy — no grandparents)
      expect(isChildModule(parent), `${parent} should not be a child module`).toBe(false)
    }
  })

  it('returns false for an unknown module', () => {
    expect(isChildModule('nonexistent')).toBe(false)
  })
})

describe('getParentModule()', () => {
  it('returns correct parent for MEDICAL_RECORDS → PATIENTS', () => {
    expect(getParentModule(MODULES.MEDICAL_RECORDS)).toBe(MODULES.PATIENTS)
  })

  it('returns correct parent for PAYMENTS → FINANCIAL_RECORDS', () => {
    expect(getParentModule(MODULES.PAYMENTS)).toBe(MODULES.FINANCIAL_RECORDS)
  })

  it('returns correct parent for USERS → SETTINGS', () => {
    expect(getParentModule(MODULES.USERS)).toBe(MODULES.SETTINGS)
  })

  it('returns null for a top-level module', () => {
    expect(getParentModule(MODULES.PATIENTS)).toBeNull()
    expect(getParentModule(MODULES.ANALYTICS)).toBeNull()
    expect(getParentModule(MODULES.APPOINTMENTS)).toBeNull()
  })

  it('returns null for an unknown module', () => {
    expect(getParentModule('nonexistent')).toBeNull()
  })
})
