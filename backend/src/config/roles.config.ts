/**
 * Roles Config — Default Role → Bundle + Scope Seed Definitions
 *
 * Defines the built-in roles that ship with the system (isSystem = true).
 * These are seeded into the DB. Admins may create additional custom roles.
 *
 * Scopes: which application interfaces this role grants access to.
 * Bundles: which permission bundles are assigned to this role.
 */

export type RoleDefinition = {
  id: string // stable slug PK
  name: string
  description: string
  isSystem: true
  scopes: Array<'portal' | 'pwa' | 'hr'>
  bundleIds: string[] // references BundleDefinition.id
}

export const SYSTEM_ROLES: RoleDefinition[] = [
  {
    id: 'admin',
    name: 'Administrator',
    description: 'Full system access. Bypasses all permission checks.',
    isSystem: true,
    // No 'pwa': admin does no work from a phone. Scope grants are now the only
    // thing deciding which apps an account can enter — checkScope no longer
    // bypasses for admin, so this list is authoritative for admin too.
    // Known consequence: admins have no self-service payslip view, because the
    // only one lives in the Team app.
    scopes: ['portal', 'hr'],
    bundleIds: [], // admin bypasses permission checks — no bundles needed
  },

  {
    id: 'hr_admin',
    name: 'HR Administrator',
    description:
      'Manages HR in the dedicated HR app: staff records, payroll, tax, performance, requests, and training. No clinic-portal access.',
    isSystem: true,
    scopes: ['hr'],
    // Reuses the existing portal-scoped HR bundles — they resolve under the HR
    // interface, which uses portal-matrix permission resolution. Least-privilege:
    // full HR, nothing clinical/financial beyond payroll + tax.
    bundleIds: [
      'bundle_dashboard',
      'bundle_staff_full',
      'bundle_payroll_full',
      'bundle_tax_calculations',
    ],
  },

  {
    id: 'doctor',
    name: 'Doctor',
    description:
      'Clinical staff with full access to patient and appointment data. Portal only — doctors do no work from the Team app.',
    isSystem: true,
    // Portal only. The Team app is personal self-service (plus the lab bench);
    // clinical work belongs on a trusted desktop at the clinic. The doctor page
    // tree in team/src/pages/doctor/ is left in place but unreachable.
    // Known consequence: doctors have no self-service payslip view, because the
    // only one lives in the Team app.
    scopes: ['portal'],
    bundleIds: [
      'bundle_dashboard',
      'bundle_clinical_doctor',
      'bundle_services_propose',
      'bundle_labs_read',
      'bundle_items_read',
      'bundle_analytics',
    ],
  },

  {
    id: 'receptionist',
    name: 'Receptionist',
    description:
      'Front-desk staff managing patients, appointments, and payments. Full portal access; Team app is personal self-service only.',
    isSystem: true,
    // Keeps 'pwa', but since pwa no longer inherits portal bundles, the only
    // grants that resolve there are the pwa-scoped ones below —
    // bundle_pwa_standard. Front-desk work stays on the portal.
    scopes: ['portal', 'pwa'],
    bundleIds: [
      'bundle_dashboard',
      'bundle_clinical_full',
      // Same as the doctor: propose catalog changes, never apply them.
      'bundle_services_propose',
      // Unlike the doctor, reception can also propose brand-new services —
      // still lands as 'pending' for an admin to approve, per bundle_services_create.
      'bundle_services_create',
      'bundle_payments_only',
      // Front desk owns day-to-day stock: they add, correct, and remove items.
      // Every create/edit/delete is written to the audit log and rolled onto
      // that day's report by the 'inventory-changes' digest provider.
      'bundle_inventory_full',
      // Raise and update lab cases, but not delete them or manage vendors.
      // A hardcoded engine rule previously granted reception labs create/update
      // on top of a read-only bundle; this bundle replaces it. Editing a base
      // service still goes through the change-request flow above (gated on
      // `services:update`).
      'bundle_labs_coordinate',
      'bundle_messaging_full',
      // Full, not read-only: the front desk is who fills and witnesses signed
      // documents at check-in. With the read bundle the Signed Documents module
      // stayed in the sidebar while every template, fill, and sign action 403'd
      // — the same trap the doctor role hit on consents.
      'bundle_compliance_full',
      'bundle_analytics',
      // Reception submits the daily report — it is their own tally of inventory
      // used, products sold, and cash taken. `bundle_analytics` alone is
      // `reports:read`, which left the page's only button dead. Delete stays
      // admin-only (see bundle_reports_submit).
      'bundle_reports_submit',
      'bundle_pwa_standard',
      // Log/view/edit (not delete) expenses for daily-report reconciliation.
      // Deliberately the narrow bundle, not bundle_financial_read — reception
      // should not see payments/ledger/journal entries/bills/suppliers/etc.
      'bundle_expenses_manage',
    ],
  },

  {
    id: 'external_trainer',
    name: 'External Trainer',
    description:
      'External/contract training personnel. HR-app access only, restricted to training authoring — no staff, payroll, or tax visibility.',
    isSystem: true,
    scopes: ['hr'],
    bundleIds: ['bundle_dashboard', 'bundle_hr_training_only'],
  },

  {
    id: 'lab_technician',
    name: 'Lab Technician',
    description:
      'Internal lab technician. Team-app only — view and update lab cases. The one role that does official work from a phone.',
    isSystem: true,
    scopes: ['pwa'],
    // Work only, no self-service bundle: lab technicians are not on payroll or
    // attendance, so bundle_pwa_standard would grant them empty screens.
    bundleIds: ['bundle_pwa_lab_technician'],
  },

  {
    id: 'staff',
    name: 'Staff',
    description:
      'Baseline non-clinical staff (assistants, hygienists, accountants, support). PWA-only self-service: own attendance, payslip, performance, training, requests, memos.',
    isSystem: true,
    scopes: ['pwa'],
    bundleIds: ['bundle_pwa_standard'],
  },
]
