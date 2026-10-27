/**
 * Centralized TanStack Query key factory.
 *
 * Using a factory (rather than inline string arrays) gives us:
 *  - Type-safe key construction
 *  - Easy cache invalidation scoped to a resource group
 *  - A single place to audit what's being cached
 *
 * Usage:
 *   useQuery({ queryKey: queryKeys.patients.list({ page: 1 }), ... })
 *   queryClient.invalidateQueries({ queryKey: queryKeys.patients.all })
 *
 * Convention:
 *   .all    → broadest scope (invalidates everything in the group)
 *   .list   → paginated / filtered lists
 *   .detail → single record by id
 */

export const queryKeys = {
  // ── Auth ────────────────────────────────────────────────────────────────────
  auth: {
    all: ['auth'] as const,
    session: () => ['auth', 'session'] as const,
    permissions: () => ['auth', 'permissions'] as const,
  },

  // ── Patients ─────────────────────────────────────────────────────────────────
  patients: {
    all: ['patients'] as const,
    list: (filters?: Record<string, unknown>) => ['patients', 'list', filters] as const,
    detail: (id: string) => ['patients', id] as const,
    timeline: (id: string) => ['patients', id, 'timeline'] as const,
    balance: (id: string) => ['patients', id, 'balance'] as const,
    tags: (id: string) => ['patients', id, 'tags'] as const,
    /** Archived invoices + payment plans, combined (archived-tab.tsx). */
    archived: (id: string) => ['patients', id, 'archived'] as const,
    /** `getPatientCredit()`'s unallocated-deposit balance — shared by
     *  invoice-composer.tsx (apply-credit button) and refund-dialog.tsx. */
    credit: (id: string) => ['patients', id, 'credit'] as const,
  },

  // ── Patient Tags (§2.7) ───────────────────────────────────────────────────────
  patientTags: {
    all: ['patient-tags'] as const,
    list: () => ['patient-tags', 'list'] as const,
  },

  // ── Appointments ─────────────────────────────────────────────────────────────
  appointments: {
    all: ['appointments'] as const,
    list: (filters?: Record<string, unknown>) => ['appointments', 'list', filters] as const,
    detail: (id: string) => ['appointments', id] as const,
    unavailability: (doctorId?: string) =>
      ['appointments', 'unavailability', doctorId ?? null] as const,
  },

  // ── CRM campaigns (recare, birthdays, follow-ups) ────────────────────────────
  crmCampaigns: {
    all: ['crm-campaigns'] as const,
    entries: (campaign: string) => ['crm-campaigns', campaign] as const,
  },

  // ── CRM ad templates ──────────────────────────────────────────────────────────
  adTemplates: {
    all: ['ad-templates'] as const,
    list: () => ['ad-templates', 'list'] as const,
  },

  // ── SMS reminder templates — shared by the bulk-SMS composer and the
  //    appointment-reminders settings section ──────────────────────────────────
  reminderTemplates: {
    all: ['reminder-templates'] as const,
    list: () => ['reminder-templates', 'list'] as const,
  },

  // ── Invoices ──────────────────────────────────────────────────────────────────
  invoices: {
    all: ['invoices'] as const,
    list: (filters?: Record<string, unknown>) => ['invoices', 'list', filters] as const,
    /** Shared with confirm-estimate-sheet.tsx's raw `GET /api/invoices/:id` read
     *  — both hit the same endpoint, so editing an invoice here refreshes that
     *  sheet's view of it too. */
    detail: (id: string) => ['invoices', id] as const,
    lines: (id: string) => ['invoices', id, 'lines'] as const,
  },

  // ── Credit Notes ───────────────────────────────────────────────────────────────
  creditNotes: {
    all: ['credit-notes'] as const,
    list: (filters?: Record<string, unknown>) => ['credit-notes', 'list', filters] as const,
  },

  // ── Payments ─────────────────────────────────────────────────────────────────
  payments: {
    all: ['payments'] as const,
    list: (filters?: Record<string, unknown>) => ['payments', 'list', filters] as const,
    detail: (id: string) => ['payments', id] as const,
  },

  // ── Patient-app payments (configured methods + confirmation requests) ──────────
  appPayments: {
    all: ['app-payments'] as const,
    methods: () => ['app-payments', 'methods'] as const,
    confirmations: (status: string) => ['app-payments', 'confirmations', status] as const,
  },

  // ── Doctors ──────────────────────────────────────────────────────────────────
  doctors: {
    all: ['doctors'] as const,
    list: () => ['doctors', 'list'] as const,
    /** The signed-in user's own doctor record, `/api/doctors/me`. */
    me: () => ['doctors', 'me'] as const,
  },

  // ── Staff ─────────────────────────────────────────────────────────────────────
  staff: {
    all: ['staff'] as const,
    list: (filters?: Record<string, unknown>) => ['staff', 'list', filters] as const,
    detail: (id: string) => ['staff', id] as const,
  },

  // ── Services ─────────────────────────────────────────────────────────────────
  services: {
    all: ['services'] as const,
    list: (filters?: Record<string, unknown>) => ['services', 'list', filters] as const,
    /** Application scopes (unit/tooth/arch/bridge…) — shared with the labs
     *  base-services tab, which uses the same `/api/services/scopes` list. */
    scopes: (includeInactive = false, includeDeleted = false) =>
      ['services', 'scopes', includeInactive, includeDeleted] as const,
    toothClasses: (includeInactive = false, includeDeleted = false) =>
      ['services', 'tooth-classes', includeInactive, includeDeleted] as const,
    doctors: (serviceId: string) => ['services', serviceId, 'doctors'] as const,
    matrix: (serviceId: string) => ['services', serviceId, 'matrix'] as const,
    /** `getPendingServices()` — despite the name, this returns change-request
     *  rows (edits to existing services), not new-service proposals; those
     *  are just `services.list()` rows with `status: 'pending'`. */
    changeRequests: () => ['services', 'change-requests'] as const,
    salesTaxes: () => ['services', 'sales-taxes'] as const,
  },

  // ── Reports-app data injection (Data Inject settings) ────────────────────────
  injectionConfigs: {
    all: ['injection-configs'] as const,
    list: () => ['injection-configs', 'list'] as const,
  },

  // ── Database management (Settings + Data Inject's manual CSV import/export) ──
  database: {
    all: ['database-management'] as const,
    manageableTables: () => ['database-management', 'tables'] as const,
    importableTables: () => ['database-management', 'importable-tables'] as const,
  },

  // ── Audit Logs ────────────────────────────────────────────────────────────────
  auditLogs: {
    all: ['audit-logs'] as const,
    list: (limit?: number, entityId?: string) =>
      ['audit-logs', 'list', limit, entityId ?? null] as const,
  },

  // ── Analytics ────────────────────────────────────────────────────────────────
  analytics: {
    all: ['analytics'] as const,
    overview: (period?: Record<string, unknown>) => ['analytics', 'overview', period] as const,
    financial: (period?: Record<string, unknown>) => ['analytics', 'financial', period] as const,
    clinical: (period?: Record<string, unknown>) => ['analytics', 'clinical', period] as const,
    insurance: (period?: Record<string, unknown>) => ['analytics', 'insurance', period] as const,
  },

  // ── Dashboard ────────────────────────────────────────────────────────────────
  dashboard: {
    all: ['dashboard'] as const,
    stats: (period?: string) => ['dashboard', 'stats', period] as const,
    actionItems: () => ['dashboard', 'action-items'] as const,
  },

  // ── Bills ─────────────────────────────────────────────────────────────────────
  bills: {
    all: ['bills'] as const,
    list: (status?: string) => ['bills', 'list', status] as const,
    detail: (id: string) => ['bills', id] as const,
  },

  // ── Accounting (chart of accounts) ────────────────────────────────────────────
  accounting: {
    all: ['accounting'] as const,
    /** `chart-of-accounts.tsx` uses its own local `['accounting','accounts']`
     *  key for the unfiltered list — this always passes a `{type}` filter, so
     *  it's a deliberately separate cache entry, not a missed reuse. */
    accounts: (filters?: Record<string, unknown>) => ['accounting', 'accounts', filters] as const,
  },

  // ── Suppliers ─────────────────────────────────────────────────────────────────
  suppliers: {
    all: ['suppliers'] as const,
    list: () => ['suppliers', 'list'] as const,
  },

  // ── Expenses ─────────────────────────────────────────────────────────────────
  expenses: {
    all: ['expenses'] as const,
    list: (filters?: Record<string, unknown>) => ['expenses', 'list', filters] as const,
  },

  // ── Products ─────────────────────────────────────────────────────────────────
  products: {
    all: ['products'] as const,
    list: () => ['products', 'list'] as const,
    detail: (id: string) => ['products', id] as const,
  },

  // ── Product Sales ─────────────────────────────────────────────────────────────
  sales: {
    all: ['sales'] as const,
    range: (startISO: string, endISO: string) => ['sales', 'range', startISO, endISO] as const,
    daily: (dateISO: string) => ['sales', 'daily', dateISO] as const,
  },

  // ── Inventory ────────────────────────────────────────────────────────────────
  inventory: {
    all: ['inventory'] as const,
    list: (params?: Record<string, unknown>) => ['inventory', 'list', params] as const,
    detail: (id: string) => ['inventory', id] as const,
    batches: (params?: Record<string, unknown>) => ['inventory', 'batches', params] as const,
    valuation: () => ['inventory', 'valuation'] as const,
  },

  // ── Ortho consent forms ───────────────────────────────────────────────────────
  orthoConsent: {
    all: ['ortho-consent'] as const,
    /** `detail.tsx` finds one row out of the same full list, so shares this key. */
    list: (searchTerm?: string) => ['ortho-consent', 'list', searchTerm ?? null] as const,
  },

  // ── Treatment Types (lookup, not payment-plan treatmentPlans) ────────────────
  treatmentTypes: {
    all: ['treatment-types'] as const,
    list: () => ['treatment-types', 'list'] as const,
  },

  // ── Patient Cases (clinical case + stage timeline) ───────────────────────────
  patientCases: {
    all: ['patient-cases'] as const,
    detail: (caseId: string) => ['patient-cases', caseId] as const,
  },

  // ── X-Rays ────────────────────────────────────────────────────────────────────
  xrays: {
    all: ['xrays'] as const,
    list: () => ['xrays', 'list'] as const,
    detail: (id: string) => ['xrays', id] as const,
    /** Same key shape `xrays/pages/index.tsx` already spreads `.all` + 'types' into. */
    types: () => ['xrays', 'types'] as const,
    patient: (patientId: string) => ['xrays', 'patient', patientId] as const,
  },

  // ── Patient media (documents + photos; x-rays share the group above) ─────────
  patientMedia: {
    all: ['patient-media'] as const,
    documents: (patientId: string) => ['patient-media', 'documents', patientId] as const,
    photos: (patientId: string) => ['patient-media', 'photos', patientId] as const,
  },

  // ── Medical Records ───────────────────────────────────────────────────────────
  medicalRecords: {
    all: ['medical-records'] as const,
    list: () => ['medical-records', 'list'] as const,
    detail: (id: string) => ['medical-records', id] as const,
    byPatient: (patientId: string) => ['medical-records', 'patient', patientId] as const,
    pending: (doctorId?: string) => ['medical-records', 'pending', doctorId ?? null] as const,
  },

  // ── Labs ──────────────────────────────────────────────────────────────────────
  labs: {
    all: ['labs'] as const,
    vendors: () => ['labs', 'vendors'] as const,
    vendorDetail: (id: string) => ['labs', 'vendors', id] as const,
    vendorServices: (id: string) => ['labs', 'vendors', id, 'services'] as const,
    cases: (filters?: Record<string, unknown>) => ['labs', 'cases', filters] as const,
    caseDetail: (id: string) => ['labs', 'cases', id] as const,
  },

  // ── Treatment Plans ───────────────────────────────────────────────────────────
  treatmentPlans: {
    all: ['treatment-plans'] as const,
    list: (filters?: Record<string, unknown>) => ['treatment-plans', 'list', filters] as const,
    patient: (patientId: string) => ['treatment-plans', 'patient', patientId] as const,
  },

  // ── Payment Plans ─────────────────────────────────────────────────────────────
  paymentPlans: {
    all: ['payment-plans'] as const,
    list: () => ['payment-plans', 'list'] as const,
    overdue: () => ['payment-plans', 'overdue'] as const,
    outstanding: () => ['payment-plans', 'outstanding'] as const,
    /** One patient's plan + derived outstanding balance — the check-in dialog's
     *  ortho-gated balance card. */
    patient: (patientId: string) => ['payment-plans', 'patient', patientId] as const,
    detail: (id: string) => ['payment-plans', id] as const,
    schedule: (id: string) => ['payment-plans', id, 'schedule'] as const,
  },

  // ── Clinic Ledger ─────────────────────────────────────────────────────────────
  clinicLedger: {
    all: ['clinic-ledger'] as const,
    outstanding: () => ['clinic-ledger', 'outstanding'] as const,
  },

  // ── Deferred Revenue ──────────────────────────────────────────────────────────
  deferredRevenue: {
    all: ['deferred-revenue'] as const,
    lines: (outstandingOnly: boolean) => ['deferred-revenue', 'lines', outstandingOnly] as const,
    events: (invoiceLineId: string) => ['deferred-revenue', 'events', invoiceLineId] as const,
  },

  // ── Fixed Assets (F6) ─────────────────────────────────────────────────────────
  fixedAssets: {
    all: ['fixed-assets'] as const,
    list: () => ['fixed-assets', 'list'] as const,
    detail: (id: string) => ['fixed-assets', id] as const,
    prepaid: () => ['fixed-assets', 'prepaid'] as const,
  },

  // ── WHT / CIT (§4.4 / §4.7) ─────────────────────────────────────────────────
  whtCit: {
    whtList: (taxYear?: number) => ['wht-certificates', taxYear] as const,
    citList: (taxYear?: number) => ['cit-installments', taxYear] as const,
    taxObligations: (year: number, month: number) => ['tax-obligations', year, month] as const,
  },

  // ── Insurance ─────────────────────────────────────────────────────────────────
  insurance: {
    all: ['insurance'] as const,
    /** Slow-moving reference list shared by every insurance picker. */
    companies: () => ['insurance', 'companies'] as const,
    /** Full company rows (incl. inactive + contact fields), for admin screens. */
    companiesFull: () => ['insurance', 'companies', 'full'] as const,
    claims: () => ['insurance', 'claims'] as const,
    approvals: () => ['insurance', 'approvals'] as const,
    reconciliation: () => ['insurance', 'reconciliation'] as const,
    /** `refreshToken` lets a sibling CSV-upload flow force a refetch by bumping it. */
    servicePrices: (companyId: string, refreshToken = 0) =>
      ['insurance', 'service-prices', companyId, refreshToken] as const,
    priceLists: (companyId: string) => ['insurance', 'price-lists', companyId] as const,
  },

  // ── Specialists ───────────────────────────────────────────────────────────────
  specialists: {
    all: ['specialists'] as const,
    list: () => ['specialists', 'list'] as const,
    // Its own key: other screens (invoice composer, kiosk, service doctors) share
    // `list()` and expect ACTIVE specialists only. Prefix invalidation of
    // `list()` still refreshes this one.
    listWithInactive: () => ['specialists', 'list', 'with-inactive'] as const,
    detail: (id: string) => ['specialists', id] as const,
  },

  // ── Settings / Lookups ────────────────────────────────────────────────────────
  settings: {
    all: ['settings'] as const,
    branding: () => ['settings', 'branding'] as const,
    locks: () => ['settings', 'locks'] as const,
    /** One clinic-settings KV entry — `GET/PUT /api/settings/kv/:key`. */
    kv: (key: string) => ['settings', 'kv', key] as const,
    /** One `/api/lookups/:type` list (payment-methods, units, categories, …). */
    lookup: (type: string) => ['settings', 'lookup', type] as const,
    appointmentAlertConfig: () => ['settings', 'appointment-alert-config'] as const,
    lowStockThreshold: () => ['settings', 'low-stock-threshold'] as const,
  },
} as const
