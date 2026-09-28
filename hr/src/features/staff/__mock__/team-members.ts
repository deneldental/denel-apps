// Team-member shape and role-options constants.
// Real data comes from `GET /api/staff` (see lib/actions/staff.ts).

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

export const TEAM_ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'doctor', label: 'Doctor' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'lab_technician', label: 'Lab Technician' },
  { value: 'external_trainer', label: 'External Trainer' },
  { value: 'staff', label: 'Staff' },
] as const

export type TeamRole = (typeof TEAM_ROLE_OPTIONS)[number]['value']
