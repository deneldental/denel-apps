// Canonical role options for audience/role pickers, derived from the
// @denel/rbac ROLES enum (the same ids stored on user.roleId). This replaces
// the hard-coded list that used to live in the staff __mock__ module.

import { type InterfaceScope, ROLE_SCOPES, ROLES } from '@/lib/modules'

const ROLE_LABELS: Record<string, string> = {
  [ROLES.ADMIN]: 'Admin',
  [ROLES.DOCTOR]: 'Doctor',
  [ROLES.RECEPTIONIST]: 'Receptionist',
  [ROLES.LAB_TECHNICIAN]: 'Lab Technician',
  [ROLES.EXTERNAL_TRAINER]: 'External Trainer',
  [ROLES.STAFF]: 'Staff',
}

export const ROLE_OPTIONS = Object.values(ROLES).map((value) => ({
  value,
  label: ROLE_LABELS[value] ?? value,
})) as ReadonlyArray<{ value: string; label: string }>

const SIGN_IN_LABELS: Record<InterfaceScope, string> = {
  portal: 'Clinic portal',
  hr: 'HR app',
  pwa: 'Team app',
}

/**
 * The apps someone onboarded through HR can sign in to: whatever their role
 * grants (ROLE_SCOPES, mirrored from the backend's roles.config.ts) plus the
 * Team app, which HR onboarding gives everyone for their own payslips,
 * requests and training. `null` = no role assigned yet.
 */
export function onboardedSignIns(roleId: string | null): string[] {
  const scopes = new Set<InterfaceScope>(['pwa', ...((roleId && ROLE_SCOPES[roleId]) || [])])
  return (['portal', 'hr', 'pwa'] as const)
    .filter((scope) => scopes.has(scope))
    .map((scope) => SIGN_IN_LABELS[scope])
}
