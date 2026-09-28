/**
 * Bundles Config — System Bundle Seed Definitions
 *
 * System bundles ship with the application (isSystem = true).
 * They are seeded into the DB and cannot be deleted via the admin UI.
 * Admins may create additional custom bundles at runtime through the UI.
 *
 * Format: each permission string is "module:action" or "module:*" (wildcard)
 */

export type BundleDefinition = {
  id: string // stable slug — used as PK for system bundles
  name: string
  description: string
  scope: 'portal' | 'pwa' | 'hr' | 'all'
  isSystem: true
  permissions: string[] // "module:action" or "module:*"
}

export const SYSTEM_BUNDLES: BundleDefinition[] = [
  // ── Clinical ──────────────────────────────────────────────────────────────

  {
    id: 'bundle_clinical_doctor',
    name: 'Doctor Clinical Access',
    description:
      'Read and update patients (no create), read and update appointments, full access to medical records and xrays, read ortho consent and insurance.',
    scope: 'portal',
    isSystem: true,
    permissions: [
      'patients:read',
      'patients:update',
      'appointments:read',
      'appointments:update',
      'medical_records:read',
      'medical_records:create',
      'medical_records:update',
      'ortho_consent:read',
      'insurance:read',
      'xrays:read',
      'xrays:create',
      'xrays:update',
    ],
  },

  {
    id: 'bundle_clinical_full',
    name: 'Clinical Full Access',
    description:
      'Read/write on all clinical modules: patients, appointments, medical records, ortho consent, insurance, X-rays. Does not include deleting patient records, medical records, or X-rays.',
    scope: 'portal',
    isSystem: true,
    // `xrays:*` was previously only implied through MODULE_HIERARCHY (patients →
    // xrays). Granting it explicitly means the medical surface stays complete
    // even if this bundle is copied, or the role is switched to matrix mode.
    //
    // patients / medical_records / xrays are deliberately NOT `:*`. The wildcard
    // swept `delete` in for every holder of this bundle — doctor and
    // receptionist alike. A hardcoded engine rule blocked receptionist deletes
    // but never doctor deletes, so doctors could delete patient records in
    // production while rbac-matrix.test.ts asserted they could not. Withholding
    // it here rather than in code makes the bundle the whole statement.
    // Appointments keep delete: cancelling a booking is routine front-desk work.
    permissions: [
      'patients:read',
      'patients:create',
      'patients:update',
      'appointments:*',
      'medical_records:read',
      'medical_records:create',
      'medical_records:update',
      'ortho_consent:*',
      'insurance:*',
      'xrays:read',
      'xrays:create',
      'xrays:update',
    ],
  },

  {
    id: 'bundle_clinical_read',
    name: 'Clinical Read Only',
    description: 'Read-only access to clinical data',
    scope: 'portal',
    isSystem: true,
    permissions: [
      'patients:read',
      'appointments:read',
      'medical_records:read',
      'ortho_consent:read',
      'insurance:read',
      'xrays:read',
    ],
  },

  // ── Insurance ─────────────────────────────────────────────────────────────

  {
    id: 'bundle_insurance_full',
    name: 'Insurance Full Access',
    description: 'Full access to insurance claims, service pricing, and patient insurance records',
    scope: 'portal',
    isSystem: true,
    permissions: ['insurance:*'],
  },

  {
    id: 'bundle_insurance_read',
    name: 'Insurance Viewer',
    description: 'Read-only access to insurance records and claims',
    scope: 'portal',
    isSystem: true,
    permissions: ['insurance:read'],
  },

  // ── Financial ─────────────────────────────────────────────────────────────

  {
    id: 'bundle_financial_full',
    name: 'Financial Full Access',
    description:
      'Full access to payments, expenses, financial records, ledger adjustments, accounts, journal entries, and periods',
    scope: 'portal',
    isSystem: true,
    permissions: [
      'payments:*',
      'expenses:*',
      'financial_records:*',
      'ledger_adjustments:*',
      'accounts:read',
      'journal_entries:read',
      'periods:read',
      'specialists:*',
      'credit_notes:*',
      'bills:*',
      'suppliers:*',
      'commissions:*',
    ],
  },

  {
    id: 'bundle_financial_read',
    name: 'Financial Viewer',
    description: 'Read-only access to financial data',
    scope: 'portal',
    isSystem: true,
    permissions: [
      'payments:read',
      'expenses:read',
      'financial_records:read',
      'ledger_adjustments:read',
      'accounts:read',
      'journal_entries:read',
      'periods:read',
      'specialists:read',
      'credit_notes:read',
      'bills:read',
      'suppliers:read',
      'commissions:read',
    ],
  },

  {
    id: 'bundle_expenses_manage',
    name: 'Expenses — Log & Edit',
    description:
      'Log, view, and edit expenses only — no delete, and no payments, ledger, or other financial records',
    scope: 'portal',
    isSystem: true,
    permissions: ['expenses:read', 'expenses:create', 'expenses:update'],
  },

  {
    id: 'bundle_accounting_admin',
    name: 'Accounting Administrator',
    description:
      'Manage the chart of accounts, post manual journal entries, and close or reopen accounting periods',
    scope: 'portal',
    isSystem: true,
    permissions: ['accounts:*', 'journal_entries:*', 'periods:*'],
  },

  {
    id: 'bundle_tax_calculations',
    name: 'Tax Calculations Access',
    description: 'View and manage tax calculation records',
    scope: 'portal',
    isSystem: true,
    permissions: ['tax_calculations:*'],
  },

  {
    id: 'bundle_payments_only',
    name: 'Payments Only',
    description: 'Create and view payments (no expenses or ledger access)',
    scope: 'portal',
    isSystem: true,
    permissions: ['payments:read', 'payments:create', 'payments:update'],
  },

  // ── Inventory ─────────────────────────────────────────────────────────────

  {
    id: 'bundle_inventory_full',
    name: 'Inventory Full Access',
    description: 'Full access to inventory and products',
    scope: 'portal',
    isSystem: true,
    permissions: ['inventory:*', 'products:*', 'items:*'],
  },

  {
    id: 'bundle_items_read',
    name: 'Items Viewer',
    description: 'Read-only access to the unified item catalog (medications, products)',
    scope: 'portal',
    isSystem: true,
    permissions: ['items:read'],
  },

  {
    id: 'bundle_inventory_read',
    name: 'Inventory Viewer',
    description: 'Read-only inventory and products',
    scope: 'portal',
    isSystem: true,
    permissions: ['inventory:read', 'products:read', 'items:read'],
  },

  // ── Staff Management (Portal side — manager view) ─────────────────────────

  {
    id: 'bundle_staff_full',
    name: 'Staff Management Full',
    description: 'Full CRUD on staff records, requests, training, and performance',
    scope: 'portal',
    isSystem: true,
    permissions: ['staff:*', 'staff_requests:*', 'staff_training:*', 'staff_performance:*'],
  },

  {
    id: 'bundle_staff_read',
    name: 'Staff Viewer',
    description: 'Read-only view of staff records and HR data',
    scope: 'portal',
    isSystem: true,
    permissions: [
      'staff:read',
      'staff_requests:read',
      'staff_training:read',
      'staff_performance:read',
    ],
  },

  // ── Payroll ────────────────────────────────────────────────────────────────
  // Split from `staff:*` so HR coordinators can manage staff records without
  // automatically gaining the ability to publish payslips (a finance action).
  {
    id: 'bundle_payroll_full',
    name: 'Payroll Full Access',
    description: 'Create, publish, and delete payslips; run pay periods',
    scope: 'portal',
    isSystem: true,
    permissions: ['payroll:*'],
  },

  {
    id: 'bundle_payroll_read',
    name: 'Payroll Viewer',
    description: 'Read-only access to payslip history and pay-run summaries',
    scope: 'portal',
    isSystem: true,
    permissions: ['payroll:read'],
  },

  // ── HR App — Training authoring (external trainers) ───────────────────────
  // Scope 'all' so it resolves under the HR interface, which uses portal-matrix
  // permission resolution. External/contract trainers get ONLY training — no
  // staff, payroll, or tax visibility. Data scope (own materials) is enforced
  // in the route handlers via uploadedById checks. Replaces the old
  // `bundle_pwa_training_only` now that trainers live in the HR app, not the PWA.
  {
    id: 'bundle_hr_training_only',
    name: 'HR Training Authoring',
    description:
      'External trainers: create, view, update, and delete their own training content from the HR app',
    scope: 'all',
    isSystem: true,
    permissions: [
      'staff_training:read',
      'staff_training:create',
      'staff_training:update',
      'staff_training:delete',
    ],
  },

  // ── Communications ────────────────────────────────────────────────────────

  {
    id: 'bundle_messaging_full',
    name: 'Messaging Full Access',
    description: 'Send and manage messages and SMS',
    scope: 'portal',
    isSystem: true,
    permissions: ['messaging:*', 'sms:*'],
  },

  // ── Compliance ────────────────────────────────────────────────────────────

  {
    id: 'bundle_compliance_full',
    name: 'Compliance Full Access',
    description: 'Full access to compliance documents and consent forms',
    scope: 'portal',
    isSystem: true,
    permissions: ['compliance:*'],
  },

  {
    id: 'bundle_compliance_read',
    name: 'Compliance Viewer',
    description: 'Read-only access to compliance documents',
    scope: 'portal',
    isSystem: true,
    permissions: ['compliance:read'],
  },

  {
    id: 'bundle_services_read',
    name: 'Services Viewer',
    description: 'Read-only access to the active service catalog and pricing matrix',
    scope: 'portal',
    isSystem: true,
    permissions: ['services:read'],
  },

  {
    id: 'bundle_services_propose',
    name: 'Services — View & Propose Changes',
    description:
      'View the service catalog and submit change requests for existing services (including lab base services). Cannot create services or apply changes directly — an admin reviews every request.',
    scope: 'portal',
    isSystem: true,
    // `services:update` is NOT a direct-write grant here: both PATCH
    // /api/services/:id and PATCH /api/labs/base-services/:id branch on admin
    // status and route non-admins into a pending change request instead.
    // Creation stays admin-only and is enforced in the route handlers.
    permissions: ['services:read', 'services:update'],
  },

  {
    id: 'bundle_services_create',
    name: 'Services — Propose New',
    description:
      'Submit brand-new services for the catalog. Like every non-admin write here, POST /api/services creates it as pending — an admin reviews and approves before it goes live.',
    scope: 'portal',
    isSystem: true,
    permissions: ['services:create'],
  },

  // ── Analytics & Reports ───────────────────────────────────────────────────

  {
    id: 'bundle_analytics',
    name: 'Analytics Access',
    description: 'View analytics dashboards and reports',
    scope: 'portal',
    isSystem: true,
    permissions: ['analytics:read', 'reports:read'],
  },

  {
    id: 'bundle_reports_full',
    name: 'Reports Full Access',
    description: 'View and submit daily/monthly reports',
    scope: 'portal',
    isSystem: true,
    permissions: ['reports:*'],
  },

  {
    id: 'bundle_reports_submit',
    name: 'Reports — View & Submit',
    description:
      'View daily reports and submit the day’s report. Cannot delete a submitted report — the frozen daily summary feeds the weekly/monthly rollups, so removing one stays with an admin.',
    scope: 'portal',
    isSystem: true,
    // Deliberately not `reports:*`: the daily report is front-desk data
    // (inventory used, products sold, restocked items), but it is also the
    // immutable input to the period rollups, so `reports:delete` is withheld.
    permissions: ['reports:read', 'reports:create'],
  },

  // ── Settings & Administration ─────────────────────────────────────────────

  {
    id: 'bundle_settings_full',
    name: 'Settings Full Access',
    description: 'Full access to system settings, users, audit logs, and integrations',
    scope: 'portal',
    isSystem: true,
    permissions: ['settings:*', 'users:*', 'audit_logs:read', 'integrations:*', 'sync:*'],
  },

  {
    id: 'bundle_users_manage',
    name: 'User Management',
    description: 'Create and manage user accounts and role assignments',
    scope: 'portal',
    isSystem: true,
    permissions: ['users:*'],
  },

  {
    id: 'bundle_audit_read',
    name: 'Audit Log Viewer',
    description: 'Read audit trail logs',
    scope: 'portal',
    isSystem: true,
    permissions: ['audit_logs:read'],
  },

  {
    id: 'bundle_integrations',
    name: 'Integrations Access',
    description: 'View and manage external integrations and data sync',
    scope: 'portal',
    isSystem: true,
    permissions: ['integrations:*', 'sync:*'],
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────

  {
    id: 'bundle_dashboard',
    name: 'Dashboard Access',
    description: 'View the main dashboard',
    scope: 'all',
    isSystem: true,
    permissions: ['dashboard:read'],
  },

  // ── Labs ──────────────────────────────────────────────────────────────────

  {
    id: 'bundle_labs_full',
    name: 'Labs Full Access',
    description: 'Full CRUD on lab vendors, services, cases, and photos',
    scope: 'portal',
    isSystem: true,
    permissions: ['labs:*'],
  },

  {
    id: 'bundle_labs_read',
    name: 'Labs Viewer',
    description: 'Read-only access to lab cases and vendors',
    scope: 'portal',
    isSystem: true,
    permissions: ['labs:read'],
  },

  {
    id: 'bundle_labs_coordinate',
    name: 'Labs Coordinator',
    description: 'Raise and update lab cases, but not delete them or manage vendors',
    scope: 'portal',
    isSystem: true,
    // Replaces a hardcoded engine rule that granted receptionists labs
    // create/update on top of their read-only bundle. Same effective access,
    // expressed where every other grant lives.
    permissions: ['labs:read', 'labs:create', 'labs:update'],
  },

  // ── X-rays ────────────────────────────────────────────────────────────────

  {
    id: 'bundle_xrays_full',
    name: 'X-rays Full Access',
    description: 'Upload, view, share, and delete X-ray records',
    scope: 'portal',
    isSystem: true,
    permissions: ['xrays:*'],
  },

  {
    id: 'bundle_xrays_read',
    name: 'X-rays Viewer',
    description: 'Read-only access to X-ray records',
    scope: 'portal',
    isSystem: true,
    permissions: ['xrays:read'],
  },

  // ── PWA — Staff Self-Service ──────────────────────────────────────────────

  {
    id: 'bundle_pwa_standard',
    name: 'PWA Standard Access',
    description:
      "Default Team-app bundle. Auto-assigned when clinic tag = staff. Shows the self-service tabs: home, own requests, own training and own payslips. The data is always the person's own.",
    scope: 'pwa',
    isSystem: true,
    // Self-service tab gates only (MY_* in @denel/rbac). The tabs read the
    // person's own records from /api/staff-portal, which checks no module
    // permission. This bundle used to carry payroll:read and staff_* grants to
    // gate the same tabs, and the admin APIs (/api/payroll, /api/staff, /api/hr)
    // accepted them — every staff member could read everyone's pay, reviews and
    // requests. Never add admin-module grants to a pwa bundle.
    permissions: ['dashboard:read', 'my_requests:read', 'my_training:read', 'my_payslips:read'],
  },

  {
    id: 'bundle_pwa_training_only',
    name: 'PWA Training Only',
    description:
      'Team app: the Training tab only (own assigned training). Training authoring lives in the HR app.',
    scope: 'pwa',
    isSystem: true,
    // This used to grant staff_training CRUD for trainers authoring from the
    // PWA. Authoring moved to the HR app (external_trainer → bundle_hr_training_only),
    // and those grants also opened the admin training APIs to the Team app.
    permissions: ['my_training:read'],
  },

  {
    id: 'bundle_pwa_lab_technician',
    name: 'PWA Lab Technician',
    description: 'Lab technician PWA access — view and update lab cases',
    scope: 'pwa',
    isSystem: true,
    permissions: ['labs:read', 'labs:update'],
  },
]
