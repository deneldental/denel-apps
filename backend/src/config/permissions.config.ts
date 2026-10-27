/**
 * Permissions Config — Seed Definitions
 *
 * This is the canonical list of every (module, action) permission pair in the
 * system. It is used to seed the `permissions` table on deploy.
 *
 * DO NOT use this file as a runtime source of truth — always query the DB.
 * Adding a permission here + running the seed script is the only way to
 * introduce a new permission into the system.
 */

export type PermissionDefinition = {
  module: string
  action: string
  description: string
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  // ── Dashboard ─────────────────────────────────────────────────────────────
  { module: 'dashboard', action: 'read', description: 'View dashboard' },

  // ── Patients ──────────────────────────────────────────────────────────────
  { module: 'patients', action: 'read', description: 'View patients' },
  { module: 'patients', action: 'create', description: 'Register new patients' },
  { module: 'patients', action: 'update', description: 'Edit patient details' },
  { module: 'patients', action: 'delete', description: 'Delete patient records' },

  // ── Appointments ──────────────────────────────────────────────────────────
  { module: 'appointments', action: 'read', description: 'View appointments' },
  { module: 'appointments', action: 'create', description: 'Book appointments' },
  { module: 'appointments', action: 'update', description: 'Reschedule / update appointments' },
  { module: 'appointments', action: 'delete', description: 'Cancel appointments' },

  // ── Medical Records (child of patients) ───────────────────────────────────
  { module: 'medical_records', action: 'read', description: 'View medical records' },
  { module: 'medical_records', action: 'create', description: 'Create medical records' },
  { module: 'medical_records', action: 'update', description: 'Update medical records' },
  { module: 'medical_records', action: 'delete', description: 'Delete medical records' },

  // ── Ortho Consent (child of patients) ─────────────────────────────────────
  { module: 'ortho_consent', action: 'read', description: 'View ortho consent forms' },
  { module: 'ortho_consent', action: 'create', description: 'Create ortho consent forms' },
  { module: 'ortho_consent', action: 'update', description: 'Update ortho consent forms' },
  { module: 'ortho_consent', action: 'delete', description: 'Delete ortho consent forms' },

  // ── Insurance (child of patients) ─────────────────────────────────────────
  { module: 'insurance', action: 'read', description: 'View insurance information' },
  { module: 'insurance', action: 'create', description: 'Add insurance records' },
  { module: 'insurance', action: 'update', description: 'Update insurance records' },
  { module: 'insurance', action: 'delete', description: 'Delete insurance records' },

  // ── Payments ──────────────────────────────────────────────────────────────
  { module: 'estimates', action: 'read', description: 'View estimates and their lines' },
  { module: 'estimates', action: 'create', description: 'Create estimates' },
  { module: 'estimates', action: 'update', description: 'Send an estimate to reception' },
  { module: 'payments', action: 'read', description: 'View payments' },
  { module: 'payments', action: 'create', description: 'Record payments' },
  { module: 'payments', action: 'update', description: 'Update payment records' },
  { module: 'payments', action: 'delete', description: 'Delete payment records' },

  // ── Payroll ───────────────────────────────────────────────────────────────
  // The HR back office (/api/payroll): pay runs, every staff member's
  // payslips, loans and tax. Staff see their own payslips via my_payslips.
  {
    module: 'payroll',
    action: 'read',
    description: "View pay runs and every staff member's payslips",
  },
  { module: 'payroll', action: 'create', description: 'Create payslip drafts and pay runs' },
  { module: 'payroll', action: 'update', description: 'Publish, unpublish, or correct payslips' },
  { module: 'payroll', action: 'delete', description: 'Delete draft payslips' },

  // ── Expenses ──────────────────────────────────────────────────────────────
  { module: 'expenses', action: 'read', description: 'View expenses' },
  { module: 'expenses', action: 'create', description: 'Log expenses' },
  { module: 'expenses', action: 'update', description: 'Edit expenses' },
  { module: 'expenses', action: 'delete', description: 'Delete expenses' },

  // ── Financial Records ─────────────────────────────────────────────────────
  { module: 'financial_records', action: 'read', description: 'View financial records' },
  { module: 'financial_records', action: 'create', description: 'Create financial records' },
  { module: 'financial_records', action: 'update', description: 'Update financial records' },
  { module: 'financial_records', action: 'delete', description: 'Delete financial records' },

  // ── Ledger Adjustments ────────────────────────────────────────────────────
  { module: 'ledger_adjustments', action: 'read', description: 'View ledger adjustments' },
  { module: 'ledger_adjustments', action: 'create', description: 'Create ledger adjustments' },
  { module: 'ledger_adjustments', action: 'update', description: 'Update ledger adjustments' },
  { module: 'ledger_adjustments', action: 'delete', description: 'Delete ledger adjustments' },

  // ── Accounts / Chart of Accounts (child of financial_records) ─────────────
  { module: 'accounts', action: 'read', description: 'View the chart of accounts' },
  { module: 'accounts', action: 'create', description: 'Create new accounts' },
  { module: 'accounts', action: 'update', description: 'Edit account details' },
  { module: 'accounts', action: 'delete', description: 'Deactivate accounts' },

  // ── Journal Entries (child of financial_records) ──────────────────────────
  { module: 'journal_entries', action: 'read', description: 'View journal entries and lines' },
  { module: 'journal_entries', action: 'create', description: 'Post manual journal entries' },
  { module: 'journal_entries', action: 'update', description: 'Annotate journal entries' },
  { module: 'journal_entries', action: 'delete', description: 'Reverse journal entries' },

  // ── Accounting Periods (child of financial_records) ───────────────────────
  { module: 'periods', action: 'read', description: 'View accounting periods' },
  { module: 'periods', action: 'create', description: 'Create accounting periods' },
  { module: 'periods', action: 'update', description: 'Close or reopen accounting periods' },
  { module: 'periods', action: 'delete', description: 'Delete accounting periods' },

  // ── Specialists (child of financial_records) ──────────────────────────────
  { module: 'specialists', action: 'read', description: 'View visiting specialists' },
  { module: 'specialists', action: 'create', description: 'Register a new specialist' },
  { module: 'specialists', action: 'update', description: 'Edit specialist details' },
  { module: 'specialists', action: 'delete', description: 'Deactivate specialists' },

  // ── Credit Notes (child of financial_records) ─────────────────────────────
  { module: 'credit_notes', action: 'read', description: 'View credit notes' },
  { module: 'credit_notes', action: 'create', description: 'Draft credit notes' },
  {
    module: 'credit_notes',
    action: 'update',
    description: 'Post credit notes (requires approval)',
  },
  { module: 'credit_notes', action: 'delete', description: 'Void posted credit notes' },

  // ── Bills / Supplier Invoices (child of financial_records) ────────────────
  { module: 'bills', action: 'read', description: 'View supplier bills' },
  { module: 'bills', action: 'create', description: 'Draft supplier bills' },
  { module: 'bills', action: 'update', description: 'Post and amend supplier bills' },
  { module: 'bills', action: 'delete', description: 'Void supplier bills' },

  // ── Suppliers (child of financial_records) ────────────────────────────────
  { module: 'suppliers', action: 'read', description: 'View supplier directory' },
  { module: 'suppliers', action: 'create', description: 'Add new suppliers' },
  { module: 'suppliers', action: 'update', description: 'Edit supplier details' },
  { module: 'suppliers', action: 'delete', description: 'Deactivate suppliers' },

  // ── Specialist Commissions (child of financial_records) ───────────────────
  { module: 'commissions', action: 'read', description: 'View specialist commissions' },
  { module: 'commissions', action: 'create', description: 'Create specialist payouts' },
  { module: 'commissions', action: 'update', description: 'Post specialist payouts' },
  { module: 'commissions', action: 'delete', description: 'Reverse specialist payouts' },

  // ── Labs ──────────────────────────────────────────────────────────────────
  { module: 'labs', action: 'read', description: 'View lab cases' },
  { module: 'labs', action: 'create', description: 'Create lab cases' },
  { module: 'labs', action: 'update', description: 'Update lab cases / status / photos' },
  { module: 'labs', action: 'delete', description: 'Delete lab cases and vendors' },

  // ── X-rays ────────────────────────────────────────────────────────────────
  { module: 'xrays', action: 'read', description: 'View X-ray records' },
  { module: 'xrays', action: 'create', description: 'Upload X-ray images' },
  { module: 'xrays', action: 'update', description: 'Update X-ray records and share links' },
  { module: 'xrays', action: 'delete', description: 'Delete X-ray records' },

  // ── Tax Calculations (child of payments) ──────────────────────────────────
  { module: 'tax_calculations', action: 'read', description: 'View tax calculations' },
  { module: 'tax_calculations', action: 'create', description: 'Create tax calculations' },
  { module: 'tax_calculations', action: 'update', description: 'Update tax calculations' },
  { module: 'tax_calculations', action: 'delete', description: 'Delete tax calculations' },

  // ── Inventory (parent) ────────────────────────────────────────────────────
  { module: 'inventory', action: 'read', description: 'View inventory' },
  { module: 'inventory', action: 'create', description: 'Add inventory items' },
  { module: 'inventory', action: 'update', description: 'Update inventory' },
  { module: 'inventory', action: 'delete', description: 'Delete inventory items' },

  // ── Services (catalog) ────────────────────────────────────────────────────
  { module: 'services', action: 'read', description: 'View active services and pricing' },
  { module: 'services', action: 'create', description: 'Create services' },
  { module: 'services', action: 'update', description: 'Edit services and pricing' },
  { module: 'services', action: 'delete', description: 'Delete services' },

  // ── Products (child of inventory) ────────────────────────────────────────
  { module: 'products', action: 'read', description: 'View products' },
  { module: 'products', action: 'create', description: 'Add products' },
  { module: 'products', action: 'update', description: 'Update products' },
  { module: 'products', action: 'delete', description: 'Delete products' },

  // ── Items (unified catalog, admin-v1 §12.1) ──────────────────────────────
  { module: 'items', action: 'read', description: 'View catalog items' },
  { module: 'items', action: 'create', description: 'Add catalog items' },
  { module: 'items', action: 'update', description: 'Update catalog items' },
  { module: 'items', action: 'delete', description: 'Delete catalog items' },

  // ── Compliance ────────────────────────────────────────────────────────────
  { module: 'compliance', action: 'read', description: 'View compliance documents' },
  { module: 'compliance', action: 'create', description: 'Add compliance documents' },
  { module: 'compliance', action: 'update', description: 'Update compliance documents' },
  { module: 'compliance', action: 'delete', description: 'Delete compliance documents' },

  // ── Messaging (parent) ────────────────────────────────────────────────────
  { module: 'messaging', action: 'read', description: 'View messages' },
  { module: 'messaging', action: 'create', description: 'Send messages' },
  { module: 'messaging', action: 'update', description: 'Update messages' },
  { module: 'messaging', action: 'delete', description: 'Delete messages' },

  // ── SMS (child of messaging) ──────────────────────────────────────────────
  { module: 'sms', action: 'read', description: 'View SMS logs' },
  { module: 'sms', action: 'create', description: 'Send SMS messages' },

  // ── Staff (parent) ────────────────────────────────────────────────────────
  { module: 'staff', action: 'read', description: 'View staff records' },
  { module: 'staff', action: 'create', description: 'Create staff records' },
  { module: 'staff', action: 'update', description: 'Update staff records' },
  { module: 'staff', action: 'delete', description: 'Delete staff records' },

  // ── Staff Requests (child of staff) ──────────────────────────────────────
  { module: 'staff_requests', action: 'read', description: 'View staff requests' },
  { module: 'staff_requests', action: 'create', description: 'Submit staff requests' },
  { module: 'staff_requests', action: 'update', description: 'Review / approve requests' },
  { module: 'staff_requests', action: 'delete', description: 'Delete staff requests' },

  // ── Staff Training (child of staff) ───────────────────────────────────────
  { module: 'staff_training', action: 'read', description: 'View training materials' },
  { module: 'staff_training', action: 'create', description: 'Create training materials' },
  { module: 'staff_training', action: 'update', description: 'Update training progress' },
  { module: 'staff_training', action: 'delete', description: 'Delete training materials' },

  // ── Staff Performance (child of staff) ────────────────────────────────────
  { module: 'staff_performance', action: 'read', description: 'View performance scores' },
  { module: 'staff_performance', action: 'create', description: 'Record performance scores' },
  { module: 'staff_performance', action: 'update', description: 'Update performance records' },
  { module: 'staff_performance', action: 'delete', description: 'Delete performance records' },

  // ── Team-app self-service (MY_* in @denel/rbac) ─────────────────────────
  // Tab gates only. The Team app reads the person's own records from
  // /api/staff-portal, which checks no module permission, and no admin API
  // accepts these — so they can never open another person's data.
  {
    module: 'my_payslips',
    action: 'read',
    description: 'Team app: show the Payslips tab (own payslips)',
  },
  {
    module: 'my_requests',
    action: 'read',
    description: 'Team app: show the Requests tab (own requests)',
  },
  {
    module: 'my_training',
    action: 'read',
    description: 'Team app: show the Training tab (own training)',
  },

  // ── Analytics ─────────────────────────────────────────────────────────────
  { module: 'analytics', action: 'read', description: 'View analytics and charts' },

  // ── Reports ───────────────────────────────────────────────────────────────
  { module: 'reports', action: 'read', description: 'View daily/monthly reports' },
  { module: 'reports', action: 'create', description: 'Submit daily reports' },
  { module: 'reports', action: 'update', description: 'Edit reports' },
  { module: 'reports', action: 'delete', description: 'Delete reports' },

  // ── Settings (parent) ─────────────────────────────────────────────────────
  { module: 'settings', action: 'read', description: 'View system settings' },
  { module: 'settings', action: 'update', description: 'Modify system settings' },

  // ── Users (child of settings) ─────────────────────────────────────────────
  { module: 'users', action: 'read', description: 'View user accounts' },
  { module: 'users', action: 'create', description: 'Create user accounts' },
  { module: 'users', action: 'update', description: 'Update user accounts' },
  { module: 'users', action: 'delete', description: 'Delete user accounts' },

  // ── Audit Logs (child of settings) ────────────────────────────────────────
  { module: 'audit_logs', action: 'read', description: 'View audit logs' },

  // ── Integrations (child of settings) ──────────────────────────────────────
  { module: 'integrations', action: 'read', description: 'View integrations' },
  { module: 'integrations', action: 'update', description: 'Manage integrations' },

  // ── Data Sync (child of settings) ─────────────────────────────────────────
  { module: 'sync', action: 'read', description: 'View data sync status' },
  { module: 'sync', action: 'create', description: 'Trigger data sync' },

  // ── Data Inject (child of settings) ───────────────────────────────────────
  { module: 'data_inject', action: 'read', description: 'View reports injection config' },
  { module: 'data_inject', action: 'update', description: 'Publish/unpublish reports sections' },
]
