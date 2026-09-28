/**
 * Per-role Team-app intent.
 *
 * The Team app is personal self-service — payslip, attendance, requests,
 * training — plus the lab bench. Official clinic work lives on the portal.
 *
 *   lab_technician   → Team (the one role doing official work here)
 *   receptionist     → Team, personal records only; front-desk work is portal
 *   staff            → Team, personal records only
 *   doctor           → Portal. No Team scope at all.
 *   admin            → Portal + HR. No Team scope at all.
 *   hr_admin         → HR app. No Team scope at all.
 *   external_trainer → HR app. No Team scope at all.
 *
 * Roles without the 'pwa' interface scope are stopped by RequireTeamAccess with
 * a "use the clinic portal" message; the homes below only decide where a
 * permitted user lands.
 */
export type AppRole =
  | 'lab_technician'
  | 'external_trainer'
  | 'doctor'
  | 'admin'
  | 'receptionist'
  | 'staff'

// 'nurse' and 'assistant' were listed here but exist in neither @denel/rbac
// ROLES nor SYSTEM_ROLES — no account can hold them. Removed rather than
// seeded; add them as real roles in roles.config.ts if the clinic needs them.
const GENERAL_STAFF_ROLES: ReadonlySet<string> = new Set([
  'admin',
  'receptionist',
  'staff',
  'nurse',
  'assistant',
])

export function getHomeForRole(role: AppRole | string | null | undefined): string {
  switch (role) {
    case 'lab_technician':
      return '/lab/home'
    case 'receptionist':
    case 'staff':
      return '/dashboard'
    // doctor, admin, hr_admin and external_trainer hold no 'pwa' scope. Sending
    // them to '/dashboard' would render the staff hub before RequireTeamAccess
    // resolved; '/login' keeps them out of the app shell entirely, and the gate
    // explains where their work actually lives.
    default:
      return '/login'
  }
}

export function isGeneralStaffRole(role: string | null | undefined): boolean {
  if (!role) return false
  return GENERAL_STAFF_ROLES.has(role)
}
