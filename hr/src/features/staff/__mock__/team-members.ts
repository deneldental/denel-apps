// Team-member shape and role-options constants.
// Real data comes from `GET /api/staff` (see lib/actions/staff.ts).

import { assignableRoleIds } from '@/lib/modules'

export interface MockTeamMember {
  id: string
  /** Auth user UUID — needed to call the scope endpoint. Null for staff without a user account. */
  userId?: string | null
  /** Human-readable staff ID e.g. "FDM-S0001". */
  staffId?: string | null
  name: string
  email: string
  phone: string | null
  /** Display label for role. Optional: HR creates staff without a role; Access Management assigns it. */
  role?: string | null
  avatarUrl: string | null
  /** Whether this is an internal clinic employee or an external contractor/trainer. */
  staffType: 'internal' | 'external'
  /** True when a corresponding user account (login credentials) exists. */
  portalAccess: boolean
  /** True when the staff record (and, if applicable, the user account) is active. */
  isActive: boolean
  /** ISO timestamp — when the staff record was first created. */
  createdAt: string
  /** ISO timestamp of last successful portal login, or null if never logged in. */
  lastLoginAt: string | null
  /** Hardware attendance reader's User ID (e.g. "120"). Null when unmapped. */
  deviceUserId?: string | null
}

/**
 * Roles assignable through a generic "System role" picker (Add Staff, Edit access,
 * registration approval). Excludes 'doctor' — it requires a linked `specialists` record
 * (specialty, licence, commission, withholding tax; also the FK target
 * `appointments.doctorId` reads) that only Portal → Specialists → Add specialist creates.
 * Assigning it from a generic picker previously granted full clinical permissions to an
 * account invisible to the appointment-booking system. See SPECIALIST_ONLY_ROLES below for
 * how an already-doctor profile is still shown correctly, read-only.
 *
 * 'external_trainer' used to be excluded for the same reason, but nothing couples it to a
 * specialist record (it opens training authoring in the HR app, nothing clinical), and
 * excluding it left no screen able to create one — so administrators can assign it (D15).
 *
 * WHICH of these a given person is offered depends on who they are: administrators get all of
 * them, an HR administrator only the everyday three. Use `roleOptionsFor`.
 */
export const TEAM_ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'lab_technician', label: 'Lab Technician' },
  { value: 'hr_admin', label: 'HR Administrator' },
  { value: 'staff', label: 'Staff' },
  { value: 'external_trainer', label: 'External Trainer' },
] as const

export type TeamRole = (typeof TEAM_ROLE_OPTIONS)[number]['value']

/** The options this person may pick from (the same rule the backend enforces). */
export function roleOptionsFor(canAssignAnyRole: boolean) {
  const allowed = new Set(assignableRoleIds(canAssignAnyRole))
  return TEAM_ROLE_OPTIONS.filter((opt) => allowed.has(opt.value))
}

/**
 * Roles that exist and can be the CURRENT value of an existing profile, but are deliberately
 * absent from TEAM_ROLE_OPTIONS above. Used to render a profile's role correctly (not blank)
 * when it's already one of these, without offering it as a new selection. Change it from
 * Portal → Specialists.
 */
export const SPECIALIST_ONLY_ROLES: Record<string, string> = {
  doctor: 'Doctor',
}
