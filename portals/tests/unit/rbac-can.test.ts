/**
 * Portal-side RBAC `can()` unit tests.
 *
 * Runs in jsdom to confirm @denel/rbac is browser-safe — no Node-only APIs.
 * The pure `can()` helper drives UI permission gating across all portal pages,
 * so every role × module × action combination that matters to the UI is covered
 * here. The backend mirrors these rules in its own rbac-matrix.test.ts.
 *
 * Key invariants tested:
 *  - Admin role always passes regardless of permissions array
 *  - Null / undefined user always fails
 *  - Module hierarchy: parent permission grants same action on all children
 *  - Non-admin roles are denied by default; only pass when in permissions list
 */

import type { UserWithRole } from '@denel/rbac'
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
} from '@denel/rbac'
import { describe, expect, it } from 'vitest'

// ── User fixtures ─────────────────────────────────────────────────────────────

const adminUser: UserWithRole = {
  id: 'u-admin',
  role: ROLES.ADMIN,
  permissions: [],
}

/** Admin with capitalised "Admin" — must NOT trigger admin bypass */
const fakeAdmin: UserWithRole = {
  id: 'u-fake-admin',
  role: 'Admin', // typo / injection attempt
  permissions: [],
}

const doctorUser: UserWithRole = {
  id: 'u-doc',
  role: ROLES.DOCTOR,
  permissions: [
    { module: MODULES.PATIENTS, action: ACTIONS.READ },
    { module: MODULES.PATIENTS, action: ACTIONS.CREATE },
    { module: MODULES.PATIENTS, action: ACTIONS.UPDATE },
    { module: MODULES.APPOINTMENTS, action: ACTIONS.READ },
    { module: MODULES.APPOINTMENTS, action: ACTIONS.CREATE },
    { module: MODULES.APPOINTMENTS, action: ACTIONS.UPDATE },
    { module: MODULES.MEDICAL_RECORDS, action: ACTIONS.READ },
    { module: MODULES.MEDICAL_RECORDS, action: ACTIONS.CREATE },
    { module: MODULES.MEDICAL_RECORDS, action: ACTIONS.UPDATE },
    { module: MODULES.CLINICAL, action: ACTIONS.READ },
    { module: MODULES.CLINICAL, action: ACTIONS.CREATE },
    { module: MODULES.CLINICAL, action: ACTIONS.UPDATE },
    { module: MODULES.XRAYS, action: ACTIONS.READ },
    { module: MODULES.XRAYS, action: ACTIONS.CREATE },
  ],
}

const receptionistUser: UserWithRole = {
  id: 'u-recep',
  role: ROLES.RECEPTIONIST,
  permissions: [
    { module: MODULES.PATIENTS, action: ACTIONS.READ },
    { module: MODULES.PATIENTS, action: ACTIONS.CREATE },
    { module: MODULES.APPOINTMENTS, action: ACTIONS.READ },
    { module: MODULES.APPOINTMENTS, action: ACTIONS.CREATE },
    { module: MODULES.APPOINTMENTS, action: ACTIONS.UPDATE },
    { module: MODULES.APPOINTMENTS, action: ACTIONS.DELETE },
    { module: MODULES.PAYMENTS, action: ACTIONS.READ },
    { module: MODULES.PAYMENTS, action: ACTIONS.CREATE },
    { module: MODULES.STAFF_REQUESTS, action: ACTIONS.READ },
  ],
}

const externalTrainerUser: UserWithRole = {
  id: 'u-trainer',
  role: ROLES.EXTERNAL_TRAINER,
  permissions: [
    { module: MODULES.STAFF_TRAINING, action: ACTIONS.READ },
    { module: MODULES.STAFF_TRAINING, action: ACTIONS.CREATE },
    { module: MODULES.STAFF_TRAINING, action: ACTIONS.UPDATE },
  ],
}

const labTechUser: UserWithRole = {
  id: 'u-lab',
  role: ROLES.LAB_TECHNICIAN,
  permissions: [
    { module: MODULES.PATIENTS, action: ACTIONS.READ },
    { module: MODULES.MEDICAL_RECORDS, action: ACTIONS.READ },
    { module: MODULES.XRAYS, action: ACTIONS.READ },
    { module: MODULES.XRAYS, action: ACTIONS.CREATE },
  ],
}

// Hierarchy test users
const userWithParentPatients: UserWithRole = {
  id: 'u-parent-patients',
  role: ROLES.DOCTOR,
  permissions: [{ module: MODULES.PATIENTS, action: ACTIONS.READ }],
}

const userWithParentFinancial: UserWithRole = {
  id: 'u-parent-fin',
  role: ROLES.RECEPTIONIST,
  permissions: [{ module: MODULES.FINANCIAL_RECORDS, action: ACTIONS.READ }],
}

const userWithParentSettings: UserWithRole = {
  id: 'u-parent-settings',
  role: ROLES.RECEPTIONIST,
  permissions: [{ module: MODULES.SETTINGS, action: ACTIONS.READ }],
}

const userWithParentStaff: UserWithRole = {
  id: 'u-parent-staff',
  role: ROLES.DOCTOR,
  permissions: [{ module: MODULES.STAFF, action: ACTIONS.READ }],
}

// ── Anonymous users ───────────────────────────────────────────────────────────

describe('anonymous / unauthenticated user', () => {
  it('null user → false for any module/action', () => {
    expect(can(null, MODULES.PATIENTS, ACTIONS.READ)).toBe(false)
    expect(can(null, MODULES.APPOINTMENTS, ACTIONS.CREATE)).toBe(false)
    expect(can(null, MODULES.ANALYTICS, ACTIONS.READ)).toBe(false)
  })

  it('undefined user → false for any module/action', () => {
    expect(can(undefined, MODULES.PATIENTS, ACTIONS.READ)).toBe(false)
    expect(can(undefined, MODULES.SETTINGS, ACTIONS.DELETE)).toBe(false)
  })

  it('null user → false even with admin module name', () => {
    expect(can(null, MODULES.ACCESS_MANAGEMENT, ACTIONS.READ)).toBe(false)
    expect(can(null, MODULES.USERS, ACTIONS.DELETE)).toBe(false)
  })
})

// ── Admin bypass ──────────────────────────────────────────────────────────────

describe('admin role bypass', () => {
  it('admin passes every module + action combination', () => {
    const allModules = Object.values(MODULES)
    const allActions = Object.values(ACTIONS)
    for (const mod of allModules) {
      for (const act of allActions) {
        expect(can(adminUser, mod, act), `admin must pass ${mod}:${act}`).toBe(true)
      }
    }
  })

  it('admin passes with empty permissions array', () => {
    expect(can(adminUser, MODULES.ANALYTICS, ACTIONS.DELETE)).toBe(true)
    expect(can(adminUser, MODULES.ACCESS_MANAGEMENT, ACTIONS.DELETE)).toBe(true)
  })

  it('capitalised "Admin" does NOT trigger admin bypass', () => {
    expect(can(fakeAdmin, MODULES.PATIENTS, ACTIONS.READ)).toBe(false)
    expect(can(fakeAdmin, MODULES.APPOINTMENTS, ACTIONS.CREATE)).toBe(false)
  })

  it('role "ADMIN" (uppercase) does NOT trigger admin bypass', () => {
    const wrongCase: UserWithRole = { id: 'u', role: 'ADMIN', permissions: [] }
    expect(can(wrongCase, MODULES.PATIENTS, ACTIONS.READ)).toBe(false)
  })
})

// ── Doctor permissions ────────────────────────────────────────────────────────

describe('doctor role permissions', () => {
  it('can read and write patients', () => {
    expect(can(doctorUser, MODULES.PATIENTS, ACTIONS.READ)).toBe(true)
    expect(can(doctorUser, MODULES.PATIENTS, ACTIONS.CREATE)).toBe(true)
    expect(can(doctorUser, MODULES.PATIENTS, ACTIONS.UPDATE)).toBe(true)
  })

  it('cannot delete patients', () => {
    expect(can(doctorUser, MODULES.PATIENTS, ACTIONS.DELETE)).toBe(false)
  })

  it('can manage clinical records and xrays', () => {
    expect(can(doctorUser, MODULES.CLINICAL, ACTIONS.READ)).toBe(true)
    expect(can(doctorUser, MODULES.CLINICAL, ACTIONS.CREATE)).toBe(true)
    expect(can(doctorUser, MODULES.XRAYS, ACTIONS.READ)).toBe(true)
    expect(can(doctorUser, MODULES.XRAYS, ACTIONS.CREATE)).toBe(true)
  })

  it('cannot access financial records', () => {
    expect(can(doctorUser, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)).toBe(false)
    expect(can(doctorUser, MODULES.PAYMENTS, ACTIONS.READ)).toBe(false)
    expect(can(doctorUser, MODULES.EXPENSES, ACTIONS.READ)).toBe(false)
  })

  it('cannot access admin-restricted modules', () => {
    expect(can(doctorUser, MODULES.USERS, ACTIONS.READ)).toBe(false)
    expect(can(doctorUser, MODULES.AUDIT_LOGS, ACTIONS.READ)).toBe(false)
    expect(can(doctorUser, MODULES.INTEGRATIONS, ACTIONS.READ)).toBe(false)
    expect(can(doctorUser, MODULES.ACCESS_MANAGEMENT, ACTIONS.READ)).toBe(false)
  })

  it('cannot access staff training (write-only belongs to trainer)', () => {
    expect(can(doctorUser, MODULES.STAFF_TRAINING, ACTIONS.CREATE)).toBe(false)
    expect(can(doctorUser, MODULES.STAFF_TRAINING, ACTIONS.DELETE)).toBe(false)
  })
})

// ── Receptionist permissions ──────────────────────────────────────────────────

describe('receptionist role permissions', () => {
  it('can read and create patients but not update or delete', () => {
    expect(can(receptionistUser, MODULES.PATIENTS, ACTIONS.READ)).toBe(true)
    expect(can(receptionistUser, MODULES.PATIENTS, ACTIONS.CREATE)).toBe(true)
    expect(can(receptionistUser, MODULES.PATIENTS, ACTIONS.UPDATE)).toBe(false)
    expect(can(receptionistUser, MODULES.PATIENTS, ACTIONS.DELETE)).toBe(false)
  })

  it('can fully manage appointments', () => {
    expect(can(receptionistUser, MODULES.APPOINTMENTS, ACTIONS.READ)).toBe(true)
    expect(can(receptionistUser, MODULES.APPOINTMENTS, ACTIONS.CREATE)).toBe(true)
    expect(can(receptionistUser, MODULES.APPOINTMENTS, ACTIONS.UPDATE)).toBe(true)
    expect(can(receptionistUser, MODULES.APPOINTMENTS, ACTIONS.DELETE)).toBe(true)
  })

  it('can create payments but not delete them', () => {
    expect(can(receptionistUser, MODULES.PAYMENTS, ACTIONS.READ)).toBe(true)
    expect(can(receptionistUser, MODULES.PAYMENTS, ACTIONS.CREATE)).toBe(true)
    expect(can(receptionistUser, MODULES.PAYMENTS, ACTIONS.DELETE)).toBe(false)
  })

  it('cannot access analytics or financial reports', () => {
    expect(can(receptionistUser, MODULES.ANALYTICS, ACTIONS.READ)).toBe(false)
    expect(can(receptionistUser, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)).toBe(false)
    expect(can(receptionistUser, MODULES.REPORTS, ACTIONS.READ)).toBe(false)
  })
})

// ── External trainer permissions ──────────────────────────────────────────────

describe('external_trainer role permissions', () => {
  it('can read, create, and update training modules', () => {
    expect(can(externalTrainerUser, MODULES.STAFF_TRAINING, ACTIONS.READ)).toBe(true)
    expect(can(externalTrainerUser, MODULES.STAFF_TRAINING, ACTIONS.CREATE)).toBe(true)
    expect(can(externalTrainerUser, MODULES.STAFF_TRAINING, ACTIONS.UPDATE)).toBe(true)
  })

  it('cannot delete training modules', () => {
    expect(can(externalTrainerUser, MODULES.STAFF_TRAINING, ACTIONS.DELETE)).toBe(false)
  })

  it('cannot access any patient or financial data', () => {
    expect(can(externalTrainerUser, MODULES.PATIENTS, ACTIONS.READ)).toBe(false)
    expect(can(externalTrainerUser, MODULES.APPOINTMENTS, ACTIONS.READ)).toBe(false)
    expect(can(externalTrainerUser, MODULES.PAYMENTS, ACTIONS.READ)).toBe(false)
    expect(can(externalTrainerUser, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)).toBe(false)
  })

  it('cannot access portal admin modules', () => {
    expect(can(externalTrainerUser, MODULES.USERS, ACTIONS.READ)).toBe(false)
    expect(can(externalTrainerUser, MODULES.AUDIT_LOGS, ACTIONS.READ)).toBe(false)
    expect(can(externalTrainerUser, MODULES.ANALYTICS, ACTIONS.READ)).toBe(false)
  })
})

// ── Lab technician permissions ────────────────────────────────────────────────

describe('lab_technician role permissions', () => {
  it('can read patients and medical records', () => {
    expect(can(labTechUser, MODULES.PATIENTS, ACTIONS.READ)).toBe(true)
    expect(can(labTechUser, MODULES.MEDICAL_RECORDS, ACTIONS.READ)).toBe(true)
  })

  it('can read and create x-rays', () => {
    expect(can(labTechUser, MODULES.XRAYS, ACTIONS.READ)).toBe(true)
    expect(can(labTechUser, MODULES.XRAYS, ACTIONS.CREATE)).toBe(true)
  })

  it('cannot update or delete patients or records', () => {
    expect(can(labTechUser, MODULES.PATIENTS, ACTIONS.UPDATE)).toBe(false)
    expect(can(labTechUser, MODULES.PATIENTS, ACTIONS.DELETE)).toBe(false)
    expect(can(labTechUser, MODULES.MEDICAL_RECORDS, ACTIONS.CREATE)).toBe(false)
    expect(can(labTechUser, MODULES.MEDICAL_RECORDS, ACTIONS.DELETE)).toBe(false)
  })

  it('cannot access financial or admin modules', () => {
    expect(can(labTechUser, MODULES.PAYMENTS, ACTIONS.READ)).toBe(false)
    expect(can(labTechUser, MODULES.ANALYTICS, ACTIONS.READ)).toBe(false)
    expect(can(labTechUser, MODULES.SETTINGS, ACTIONS.READ)).toBe(false)
  })
})

// ── Module hierarchy expansion ────────────────────────────────────────────────

describe('PATIENTS parent → child module expansion', () => {
  it('PATIENTS:read grants MEDICAL_RECORDS:read', () => {
    expect(can(userWithParentPatients, MODULES.MEDICAL_RECORDS, ACTIONS.READ)).toBe(true)
  })

  it('PATIENTS:read grants ORTHO_CONSENT:read', () => {
    expect(can(userWithParentPatients, MODULES.ORTHO_CONSENT, ACTIONS.READ)).toBe(true)
  })

  it('PATIENTS:read grants INSURANCE:read', () => {
    expect(can(userWithParentPatients, MODULES.INSURANCE, ACTIONS.READ)).toBe(true)
  })

  it('PATIENTS:read grants XRAYS:read', () => {
    expect(can(userWithParentPatients, MODULES.XRAYS, ACTIONS.READ)).toBe(true)
  })

  it('PATIENTS:read does NOT grant MEDICAL_RECORDS:create (different action)', () => {
    expect(can(userWithParentPatients, MODULES.MEDICAL_RECORDS, ACTIONS.CREATE)).toBe(false)
  })

  it('PATIENTS:read does NOT grant unrelated modules', () => {
    expect(can(userWithParentPatients, MODULES.ANALYTICS, ACTIONS.READ)).toBe(false)
    expect(can(userWithParentPatients, MODULES.PAYMENTS, ACTIONS.READ)).toBe(false)
    expect(can(userWithParentPatients, MODULES.USERS, ACTIONS.READ)).toBe(false)
  })
})

describe('FINANCIAL_RECORDS parent → child module expansion', () => {
  it('FINANCIAL_RECORDS:read grants PAYMENTS:read', () => {
    expect(can(userWithParentFinancial, MODULES.PAYMENTS, ACTIONS.READ)).toBe(true)
  })

  it('FINANCIAL_RECORDS:read grants EXPENSES:read', () => {
    expect(can(userWithParentFinancial, MODULES.EXPENSES, ACTIONS.READ)).toBe(true)
  })

  it('FINANCIAL_RECORDS:read grants BILLS:read', () => {
    expect(can(userWithParentFinancial, MODULES.BILLS, ACTIONS.READ)).toBe(true)
  })

  it('FINANCIAL_RECORDS:read grants CREDIT_NOTES:read', () => {
    expect(can(userWithParentFinancial, MODULES.CREDIT_NOTES, ACTIONS.READ)).toBe(true)
  })

  it('FINANCIAL_RECORDS:read grants JOURNAL_ENTRIES:read', () => {
    expect(can(userWithParentFinancial, MODULES.JOURNAL_ENTRIES, ACTIONS.READ)).toBe(true)
  })

  it('FINANCIAL_RECORDS:read does NOT grant PAYMENTS:create', () => {
    expect(can(userWithParentFinancial, MODULES.PAYMENTS, ACTIONS.CREATE)).toBe(false)
  })

  it('FINANCIAL_RECORDS:read does NOT grant unrelated modules', () => {
    expect(can(userWithParentFinancial, MODULES.PATIENTS, ACTIONS.READ)).toBe(false)
    expect(can(userWithParentFinancial, MODULES.USERS, ACTIONS.READ)).toBe(false)
  })
})

describe('SETTINGS parent → child module expansion', () => {
  it('SETTINGS:read grants USERS:read', () => {
    expect(can(userWithParentSettings, MODULES.USERS, ACTIONS.READ)).toBe(true)
  })

  it('SETTINGS:read grants AUDIT_LOGS:read', () => {
    expect(can(userWithParentSettings, MODULES.AUDIT_LOGS, ACTIONS.READ)).toBe(true)
  })

  it('SETTINGS:read grants INTEGRATIONS:read', () => {
    expect(can(userWithParentSettings, MODULES.INTEGRATIONS, ACTIONS.READ)).toBe(true)
  })

  it('SETTINGS:read does NOT grant USERS:delete', () => {
    expect(can(userWithParentSettings, MODULES.USERS, ACTIONS.DELETE)).toBe(false)
  })

  it('SETTINGS:read does NOT grant patient modules', () => {
    expect(can(userWithParentSettings, MODULES.PATIENTS, ACTIONS.READ)).toBe(false)
    expect(can(userWithParentSettings, MODULES.APPOINTMENTS, ACTIONS.READ)).toBe(false)
  })
})

describe('STAFF parent → child module expansion', () => {
  it('STAFF:read grants STAFF_REQUESTS:read', () => {
    expect(can(userWithParentStaff, MODULES.STAFF_REQUESTS, ACTIONS.READ)).toBe(true)
  })

  it('STAFF:read grants STAFF_TRAINING:read', () => {
    expect(can(userWithParentStaff, MODULES.STAFF_TRAINING, ACTIONS.READ)).toBe(true)
  })

  it('STAFF:read grants STAFF_PERFORMANCE:read', () => {
    expect(can(userWithParentStaff, MODULES.STAFF_PERFORMANCE, ACTIONS.READ)).toBe(true)
  })

  it('STAFF:read does NOT grant STAFF_TRAINING:create', () => {
    expect(can(userWithParentStaff, MODULES.STAFF_TRAINING, ACTIONS.CREATE)).toBe(false)
  })
})

// ── Helper function tests ──────────────────────────────────────────────────────

describe('isParentModule()', () => {
  it('returns true for all defined parent modules', () => {
    for (const parent of Object.keys(MODULE_HIERARCHY)) {
      expect(isParentModule(parent), `${parent} should be parent`).toBe(true)
    }
  })

  it('returns false for child-only modules', () => {
    expect(isParentModule(MODULES.MEDICAL_RECORDS)).toBe(false)
    expect(isParentModule(MODULES.PAYMENTS)).toBe(false)
    expect(isParentModule(MODULES.XRAYS)).toBe(false)
    expect(isParentModule(MODULES.USERS)).toBe(false)
  })

  it('returns false for leaf modules that are neither parent nor child', () => {
    expect(isParentModule(MODULES.ANALYTICS)).toBe(false)
    expect(isParentModule(MODULES.APPOINTMENTS)).toBe(false)
  })
})

describe('getChildModules()', () => {
  it('returns children of PATIENTS', () => {
    const children = getChildModules(MODULES.PATIENTS)
    expect(children).toContain(MODULES.MEDICAL_RECORDS)
    expect(children).toContain(MODULES.ORTHO_CONSENT)
    expect(children).toContain(MODULES.INSURANCE)
    expect(children).toContain(MODULES.XRAYS)
  })

  it('returns children of FINANCIAL_RECORDS', () => {
    const children = getChildModules(MODULES.FINANCIAL_RECORDS)
    expect(children).toContain(MODULES.PAYMENTS)
    expect(children).toContain(MODULES.EXPENSES)
    expect(children).toContain(MODULES.BILLS)
  })

  it('returns empty array for non-parent modules', () => {
    expect(getChildModules(MODULES.ANALYTICS)).toEqual([])
    expect(getChildModules(MODULES.XRAYS)).toEqual([])
    expect(getChildModules('nonexistent_module')).toEqual([])
  })
})

describe('isChildModule()', () => {
  it('returns true for child modules', () => {
    expect(isChildModule(MODULES.MEDICAL_RECORDS)).toBe(true)
    expect(isChildModule(MODULES.PAYMENTS)).toBe(true)
    expect(isChildModule(MODULES.USERS)).toBe(true)
    expect(isChildModule(MODULES.XRAYS)).toBe(true)
  })

  it('returns false for top-level parent modules', () => {
    expect(isChildModule(MODULES.PATIENTS)).toBe(false)
    expect(isChildModule(MODULES.FINANCIAL_RECORDS)).toBe(false)
    expect(isChildModule(MODULES.SETTINGS)).toBe(false)
  })

  it('returns false for standalone modules', () => {
    expect(isChildModule(MODULES.ANALYTICS)).toBe(false)
    expect(isChildModule(MODULES.APPOINTMENTS)).toBe(false)
    expect(isChildModule(MODULES.REPORTS)).toBe(false)
  })
})

describe('getParentModule()', () => {
  it('returns PATIENTS for its children', () => {
    expect(getParentModule(MODULES.MEDICAL_RECORDS)).toBe(MODULES.PATIENTS)
    expect(getParentModule(MODULES.ORTHO_CONSENT)).toBe(MODULES.PATIENTS)
    expect(getParentModule(MODULES.INSURANCE)).toBe(MODULES.PATIENTS)
    expect(getParentModule(MODULES.XRAYS)).toBe(MODULES.PATIENTS)
  })

  it('returns FINANCIAL_RECORDS for its children', () => {
    expect(getParentModule(MODULES.PAYMENTS)).toBe(MODULES.FINANCIAL_RECORDS)
    expect(getParentModule(MODULES.EXPENSES)).toBe(MODULES.FINANCIAL_RECORDS)
    expect(getParentModule(MODULES.BILLS)).toBe(MODULES.FINANCIAL_RECORDS)
  })

  it('returns SETTINGS for its children', () => {
    expect(getParentModule(MODULES.USERS)).toBe(MODULES.SETTINGS)
    expect(getParentModule(MODULES.AUDIT_LOGS)).toBe(MODULES.SETTINGS)
    expect(getParentModule(MODULES.INTEGRATIONS)).toBe(MODULES.SETTINGS)
  })

  it('returns null for top-level modules and standalone modules', () => {
    expect(getParentModule(MODULES.PATIENTS)).toBeNull()
    expect(getParentModule(MODULES.ANALYTICS)).toBeNull()
    expect(getParentModule(MODULES.APPOINTMENTS)).toBeNull()
    expect(getParentModule('no_such_module')).toBeNull()
  })
})

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('user with empty permissions array is denied everything', () => {
    const emptyPermsUser: UserWithRole = { id: 'u', role: ROLES.DOCTOR, permissions: [] }
    expect(can(emptyPermsUser, MODULES.PATIENTS, ACTIONS.READ)).toBe(false)
    expect(can(emptyPermsUser, MODULES.APPOINTMENTS, ACTIONS.READ)).toBe(false)
  })

  it('user with no permissions field is denied everything', () => {
    const noPermsUser: UserWithRole = { id: 'u', role: ROLES.RECEPTIONIST }
    expect(can(noPermsUser, MODULES.APPOINTMENTS, ACTIONS.READ)).toBe(false)
  })

  it('can() is case-sensitive on module names', () => {
    const user: UserWithRole = {
      id: 'u',
      role: ROLES.DOCTOR,
      permissions: [{ module: 'patients', action: 'read' }],
    }
    expect(can(user, 'patients', 'read')).toBe(true)
    expect(can(user, 'PATIENTS', 'read')).toBe(false)
    expect(can(user, 'patients', 'READ')).toBe(false)
  })

  it('multiple overlapping permissions: highest grant wins', () => {
    // User has both direct MEDICAL_RECORDS:read AND parent PATIENTS:read
    // Both paths lead to true — no conflict, just redundancy
    const user: UserWithRole = {
      id: 'u',
      role: ROLES.DOCTOR,
      permissions: [
        { module: MODULES.PATIENTS, action: ACTIONS.READ },
        { module: MODULES.MEDICAL_RECORDS, action: ACTIONS.READ },
        { module: MODULES.MEDICAL_RECORDS, action: ACTIONS.CREATE },
      ],
    }
    expect(can(user, MODULES.MEDICAL_RECORDS, ACTIONS.READ)).toBe(true)
    expect(can(user, MODULES.MEDICAL_RECORDS, ACTIONS.CREATE)).toBe(true)
    // DELETE still not granted by either
    expect(can(user, MODULES.MEDICAL_RECORDS, ACTIONS.DELETE)).toBe(false)
  })
})
