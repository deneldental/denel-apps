/**
 * The decisions behind the HR screens that hand out roles and first passwords (D15 / D16).
 *
 * Pulled out of the components so they can be tested without a browser. The server enforces every
 * rule independently; these decide only what the screens OFFER and when they let a button through,
 * so that what a person is shown is exactly what the server will accept.
 */
import { HR_ASSIGNABLE_ROLES, roleSignsInWithPassword } from '@/lib/modules'
import { roleOptionsFor, SPECIALIST_ONLY_ROLES, TEAM_ROLE_OPTIONS } from './__mock__/team-members'

// ── The Add Staff wizard's role picker ──────────────────────────────────────────

/**
 * The system roles the Add Staff wizard can onboard, with the hint shown under the picker. The
 * role decides what the person can do and where they sign in; everyone onboarded here also keeps
 * the Team app for their own payslips, requests and training. `doctor` is absent because doctors
 * are made by Add specialist.
 */
export const WIZARD_ROLES = [
  {
    value: 'staff',
    label: 'Staff',
    hint: 'Payslips, requests, training and attendance in the Team app.',
  },
  {
    value: 'receptionist',
    label: 'Receptionist',
    hint: 'Front-desk work in the clinic portal: patients, appointments and payments.',
  },
  { value: 'lab_technician', label: 'Lab Technician', hint: 'Lab cases in the Team app.' },
  {
    value: 'hr_admin',
    label: 'HR Administrator',
    hint: 'Staff records, payroll, tax, performance and training in the HR app.',
  },
  {
    value: 'external_trainer',
    label: 'External Trainer',
    hint: 'Training authoring in the HR app only.',
  },
  { value: 'admin', label: 'Admin', hint: 'Full access to the clinic portal and the HR app.' },
] as const

export type WizardRole = (typeof WIZARD_ROLES)[number]

/** The wizard roles this person may give: everything for an administrator, the everyday three otherwise. */
export function wizardRoleOptions(canAssignAnyRole: boolean): readonly WizardRole[] {
  const offered = new Set(roleOptionsFor(canAssignAnyRole).map((o) => o.value as string))
  return WIZARD_ROLES.filter((r) => offered.has(r.value))
}

// ── The role control on Edit access ─────────────────────────────────────────────

export type RoleControl =
  | { kind: 'editable' }
  /** Doctors are made and changed from Specialists, not from a role picker. */
  | { kind: 'specialist-only'; label: string }
  /** A role only an administrator may change; shown as it is, read-only. */
  | { kind: 'admin-only'; label: string }

/**
 * What the System role control shows for someone currently holding `currentRole` (null = none), to
 * a viewer who can (`canAssignAnyRole`) or cannot assign every role. An HR administrator may
 * change only people who hold an everyday role or none; anyone else's role is shown read-only, as
 * the server would refuse the change.
 */
export function roleControlFor(
  currentRole: string | null | undefined,
  canAssignAnyRole: boolean
): RoleControl {
  if (currentRole && SPECIALIST_ONLY_ROLES[currentRole]) {
    return { kind: 'specialist-only', label: SPECIALIST_ONLY_ROLES[currentRole] }
  }
  if (canAssignAnyRole || !currentRole || HR_ASSIGNABLE_ROLES.includes(currentRole)) {
    return { kind: 'editable' }
  }
  return {
    kind: 'admin-only',
    label: TEAM_ROLE_OPTIONS.find((o) => o.value === currentRole)?.label ?? currentRole,
  }
}

// ── Approving a self-registration ───────────────────────────────────────────────

/** Shortest first password the server accepts (backend lib/password-policy MIN_PASSWORD_LENGTH). */
export const MIN_FIRST_PASSWORD = 12

export interface ApprovalAccessInput {
  /** The chosen role id, or 'none' for "assign later". */
  role: string
  /** The e-mail the registrant gave, possibly empty. */
  registrantEmail: string
  initialPassword: string
}

/**
 * Portal and HR sign in with an e-mail and a password; the Team app is a phone number and an SMS
 * code. A role that signs in with a password therefore needs the registrant's e-mail and a first
 * password from the reviewer, which the person must replace at first sign-in. Without both they
 * would hold a role they cannot use until an admin reset their password (D16, F49).
 */
export function approvalAccess(input: ApprovalAccessInput) {
  const needsPassword = roleSignsInWithPassword(input.role === 'none' ? null : input.role)
  const missingEmail = needsPassword && !input.registrantEmail.trim()
  const passwordTooShort = needsPassword && input.initialPassword.length < MIN_FIRST_PASSWORD
  return {
    needsPassword,
    missingEmail,
    passwordTooShort,
    canApprove: !missingEmail && !passwordTooShort,
    passwordToSend: needsPassword ? input.initialPassword : undefined,
  }
}
