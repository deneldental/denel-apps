// @denel/rbac — single source of truth for module/action/role identifiers
// and the module hierarchy used by both the backend permission engine and the
// portal nav gating.
//
// Module string values must match exactly what's stored in the `permissions`
// table (seeded from backend/src/config/permissions.config.ts). Roles match
// `roles.id` rows seeded from backend/src/config/roles.config.ts.

export const MODULES = {
  ACCOUNTS: 'accounts',
  ANALYTICS: 'analytics',
  APPOINTMENTS: 'appointments',
  AUDIT_LOGS: 'audit_logs',
  ACCESS_MANAGEMENT: 'access_management',
  BILLS: 'bills',
  COMMISSIONS: 'commissions',
  COMPLIANCE: 'compliance',
  CREDIT_NOTES: 'credit_notes',
  DASHBOARD: 'dashboard',
  DATA_INJECT: 'data_inject',
  DATA_SYNC: 'sync',
  // Build, view and list estimates (draft one-time invoices) without any access to
  // payments. A child of `payments` and `financial_records` in the hierarchy below,
  // so every role that already holds payments access keeps estimates access.
  ESTIMATES: 'estimates',
  EXPENSES: 'expenses',
  FINANCIAL_RECORDS: 'financial_records',
  INSURANCE: 'insurance',
  INTEGRATIONS: 'integrations',
  INVENTORY: 'inventory',
  // Unified item catalog (admin-v1 §12.1). Grants are mirrored from inventory/
  // products by migration 0101 + bundles.config so existing roles keep access.
  ITEMS: 'items',
  JOURNAL_ENTRIES: 'journal_entries',
  LABS: 'labs',
  LEDGER_ADJUSTMENTS: 'ledger_adjustments',
  MEDICAL_RECORDS: 'medical_records',
  MESSAGING: 'messaging',
  // Team-app self-service tabs. They only decide which tabs a staff member sees
  // in the Team app; the data behind those tabs comes from /api/staff-portal,
  // which serves the caller's own records and checks no module permission. No
  // admin API accepts them — unlike the payroll / staff_* reads the Team bundle
  // used to carry, which also opened everyone's pay, reviews and requests.
  MY_PAYSLIPS: 'my_payslips',
  MY_REQUESTS: 'my_requests',
  MY_TRAINING: 'my_training',
  ORTHO_CONSENT: 'ortho_consent',
  PATIENTS: 'patients',
  PAYMENTS: 'payments',
  // PAYROLL is the HR back office: pay runs, every staff member's payslips,
  // loans and tax (/api/payroll). Staff see their own payslips through
  // MY_PAYSLIPS instead — never grant this for the Team app.
  PAYROLL: 'payroll',
  PERIODS: 'periods',
  PRODUCTS: 'products',
  RECARE: 'recare',
  REPORTS: 'reports',
  SERVICES: 'services',
  SETTINGS: 'settings',
  SMS: 'sms',
  SPECIALISTS: 'specialists',
  STAFF: 'staff',
  STAFF_PERFORMANCE: 'staff_performance',
  STAFF_REQUESTS: 'staff_requests',
  STAFF_TRAINING: 'staff_training',
  SUPPLIERS: 'suppliers',
  TAX_CALCULATIONS: 'tax_calculations',
  USERS: 'users',
  XRAYS: 'xrays',
} as const

export type Module = (typeof MODULES)[keyof typeof MODULES]

export const ACTIONS = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
} as const

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS]

export const ROLES = {
  ADMIN: 'admin',
  DOCTOR: 'doctor',
  RECEPTIONIST: 'receptionist',
  EXTERNAL_TRAINER: 'external_trainer',
  LAB_TECHNICIAN: 'lab_technician',
  STAFF: 'staff',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

/** The apps a person can sign in to: clinic portal, Team app (pwa), HR app. */
export type InterfaceScope = 'portal' | 'pwa' | 'hr'

/**
 * Where each built-in role can sign in. Mirrors the `scopes` in
 * backend/src/config/roles.config.ts — seed-rbac re-syncs role_scopes from that
 * file on every deploy, and backend/tests/unit/rbac-config.test.ts fails if the
 * two disagree. Per-person exceptions live in user_scopes (HR → Access → Edit
 * access), which override the role for that one person.
 */
export const ROLE_SCOPES: Readonly<Record<string, readonly InterfaceScope[]>> = {
  admin: ['portal', 'hr'],
  hr_admin: ['hr'],
  doctor: ['portal'],
  receptionist: ['portal', 'pwa'],
  external_trainer: ['hr'],
  lab_technician: ['pwa'],
  staff: ['pwa'],
}

// ─── Who may give which role, and who signs in with a password ──────────────────
//
// One definition for the backend (which enforces it) and the HR screens (which use it to
// decide what to offer), so the two cannot drift apart.

/**
 * The roles an HR Administrator may assign — and the only roles whose current holders they
 * may re-assign (decision D15). Everything else needs an administrator: `admin` and
 * `hr_admin` because they are the privileged roles, `doctor` because it needs a specialist
 * record, `external_trainer` because it opens the HR app.
 *
 * Without the second half, "set this person to Receptionist" would demote an administrator.
 */
export const HR_ASSIGNABLE_ROLES: readonly string[] = ['staff', 'receptionist', 'lab_technician']

/**
 * May a caller who is NOT a full administrator move someone from `targetCurrentRole` to
 * `nextRole`? `null`/`undefined` mean "no role". Administrators are not asked: they may
 * assign any assignable role (the backend still refuses roles no screen may assign).
 */
export function canDelegateRoleChange(
  targetCurrentRole: string | null | undefined,
  nextRole: string | null | undefined
): boolean {
  const ok = (r: string | null | undefined) => r == null || HR_ASSIGNABLE_ROLES.includes(r)
  return ok(targetCurrentRole) && ok(nextRole)
}

/**
 * The roles a generic role picker offers. `doctor` is never among them: it needs a specialist
 * record, so it is made only by Add specialist.
 */
export function assignableRoleIds(callerIsFullAdministrator: boolean): readonly string[] {
  return callerIsFullAdministrator
    ? ['admin', 'hr_admin', 'external_trainer', 'lab_technician', 'receptionist', 'staff']
    : HR_ASSIGNABLE_ROLES
}

/**
 * Does this role (plus any one-off scope grants) sign in to the clinic portal or the HR app?
 * Those sign in with an e-mail and a password. The Team app does not: it is phone number plus
 * an SMS code, so a Team-only person never types a password.
 */
export function roleSignsInWithPassword(
  roleId: string | null | undefined,
  extraScopes: readonly string[] = []
): boolean {
  const scopes: readonly string[] = [...((roleId && ROLE_SCOPES[roleId]) || []), ...extraScopes]
  return scopes.some((scope) => scope === 'portal' || scope === 'hr')
}

// Module hierarchy — granting access to a parent implies the listed children.
// Mirrored by backend/src/rbac/engine/HierarchyResolver.ts.
export const MODULE_HIERARCHY: Record<string, { children: string[] }> = {
  [MODULES.PATIENTS]: {
    children: [MODULES.MEDICAL_RECORDS, MODULES.ORTHO_CONSENT, MODULES.INSURANCE, MODULES.XRAYS],
  },
  [MODULES.INVENTORY]: { children: [MODULES.PRODUCTS] },
  [MODULES.STAFF]: {
    children: [MODULES.STAFF_REQUESTS, MODULES.STAFF_TRAINING, MODULES.STAFF_PERFORMANCE],
  },
  [MODULES.SETTINGS]: {
    children: [
      MODULES.USERS,
      MODULES.AUDIT_LOGS,
      MODULES.DATA_SYNC,
      MODULES.INTEGRATIONS,
      MODULES.DATA_INJECT,
    ],
  },
  [MODULES.MESSAGING]: { children: [MODULES.SMS] },
  [MODULES.FINANCIAL_RECORDS]: {
    children: [
      MODULES.LEDGER_ADJUSTMENTS,
      MODULES.ACCOUNTS,
      MODULES.JOURNAL_ENTRIES,
      MODULES.PERIODS,
      MODULES.SPECIALISTS,
      MODULES.CREDIT_NOTES,
      MODULES.BILLS,
      MODULES.SUPPLIERS,
      MODULES.COMMISSIONS,
      // L12: payments / expenses / tax_calculations are finance sub-modules too —
      // without these, a user granted `financial_records` could not reach them.
      MODULES.PAYMENTS,
      MODULES.EXPENSES,
      MODULES.TAX_CALCULATIONS,
      // Expansion is one level deep (a child of a child is not implied), so
      // estimates is listed here as well as under `payments`.
      MODULES.ESTIMATES,
    ],
  },
  [MODULES.PAYMENTS]: { children: [MODULES.ESTIMATES] },
}

export function isParentModule(module: string): boolean {
  return module in MODULE_HIERARCHY
}

export function getChildModules(module: string): string[] {
  return MODULE_HIERARCHY[module]?.children ?? []
}

export function isChildModule(module: string): boolean {
  for (const cfg of Object.values(MODULE_HIERARCHY)) {
    if (cfg.children.includes(module)) return true
  }
  return false
}

export function getParentModule(module: string): string | null {
  return getParentModules(module)[0] ?? null
}

/** Every module whose grant implies this one. A module can have more than one parent. */
export function getParentModules(module: string): string[] {
  const parents: string[] = []
  for (const [parent, cfg] of Object.entries(MODULE_HIERARCHY)) {
    if (cfg.children.includes(module)) parents.push(parent)
  }
  return parents
}

// Permission shape persisted in the DB.
export type Permission = {
  module: string
  action: string
}

// Minimal user shape used by `can()` for UI gating. Backends pre-resolve a
// user's permissions (including hierarchy expansion) and ship the flat list
// to the frontend; the frontend then calls `can()` per render.
export type UserWithRole = {
  id: string
  role: Role | string
  permissions?: Permission[]
}

/**
 * Pure UI helper — returns true if the user can perform `action` on `module`.
 * Honors the module hierarchy: a permission on a parent grants the same action
 * on every child module.
 *
 * Admins always pass. Anonymous (`null`/`undefined`) users always fail.
 */
export function can(
  user: UserWithRole | null | undefined,
  module: string,
  action: string
): boolean {
  if (!user) return false
  if (user.role === ROLES.ADMIN) return true
  const perms = user.permissions ?? []
  if (perms.some((p) => p.module === module && p.action === action)) return true
  // Any parent's grant of the same action implies it (a module can have several).
  for (const parent of getParentModules(module)) {
    if (perms.some((p) => p.module === parent && p.action === action)) return true
  }
  return false
}
