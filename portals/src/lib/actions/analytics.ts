import { api } from '@/lib/api-client'

/**
 * Build the query suffix the backend's parsePeriod() helper reads. Pass `null`
 * to skip — the endpoint will fall back to its default rolling window.
 */
export function buildPeriodQuery(
  period: {
    granularity: 'monthly' | 'quarterly' | 'yearly'
    from: Date
    to: Date
    label: string
  } | null
): string {
  if (!period) return ''
  const p = new URLSearchParams()
  p.set('granularity', period.granularity)
  p.set('from', period.from.toISOString())
  p.set('to', period.to.toISOString())
  p.set('label', period.label)
  return `?${p.toString()}`
}

export interface MonthlyPatients {
  month: string
  count: number
  growth: number | null
}

export interface TreatmentRevenue {
  name: string
  amount: number
  percentage: number
}

export interface ExpenseCategory {
  category: string
  amount: number
  percentage: number
}

export interface PaymentMethod {
  method: string
  count: number
  amount: number
  percentage: number
}

export interface TreatmentBreakdown {
  name: string
  count: number
  percentage: number
}

export interface QuarterData {
  patients: {
    total: number
    monthly: MonthlyPatients[]
  }
  revenue: {
    total: number
    byTreatment: TreatmentRevenue[]
  }
  expenses: {
    total: number
    byCategory: ExpenseCategory[]
  }
  paymentMethods: PaymentMethod[]
  treatments: TreatmentBreakdown[]
}

export interface AnalyticsData {
  year: number
  Q1: QuarterData
  Q2: QuarterData
  Q3: QuarterData
  Q4: QuarterData
}

export async function getAnalytics(year: number) {
  const res = await api.get<AnalyticsData>(`/api/analytics?year=${year}`)
  return { success: res.success, data: res.data, error: res.error }
}

// ── Executive Overview ────────────────────────────────────────────────────────

export interface OverviewTileWithDelta {
  value: number
  deltaPct: number | null
  vs: string
}

export interface ExecutiveOverview {
  generatedAt: string
  tiles: {
    todayRevenue: OverviewTileWithDelta
    patientsSeenToday: { value: number; sevenDayAverage: number }
    mtdCashPosition: OverviewTileWithDelta
    openAR: { value: number }
    openAP: { value: number }
    noShowRate7d: { value: number; totalAppointments: number; noShows: number }
    stockAtRisk: { value: number }
    credentialsExpiring30d: { value: number }
    insuranceBacklog: { value: number; records: number }
    syncErrors24h: { value: number }
    patientCompletenessPct: { total: number; withPhonePct: number; withEmailPct: number }
  }
  revenueTrend: Array<{
    day: string
    cash: number
    card: number
    momo: number
    insurance: number
    transfer: number
    other: number
    total: number
  }>
  appointmentTrend: Array<{
    day: string
    booked: number
    completed: number
    noShow: number
    cancelled: number
  }>
}

export async function getExecutiveOverview(periodQuery = '') {
  const res = await api.get<ExecutiveOverview>(`/api/analytics/executive-overview${periodQuery}`)
  return { success: res.success, data: res.data, error: res.error }
}

// ── Operational: Appointments ────────────────────────────────────────────────

export interface AppointmentOperational {
  generatedAt: string
  window: { days: number; from: string; to: string }
  tiles: {
    totalAppointments: number
    completed: number
    noShow: number
    cancelled: number
    noShowRate: number
    cancellationRate: number
    avgLeadDays: number
    avgActualMinutes: number
    avgScheduledMinutes: number
    utilizationRatioPct: number
    confirmationResponseRatePct: number
    confirmationYesRatePct: number
  }
  funnel: Array<{ stage: string; count: number }>
  lost: { noShow: number; cancelled: number }
  dowHeat: Array<{ dow: number; hour: number; count: number }>
  maxHeat: number
  noShowByType: Array<{
    type: string
    total: number
    completed: number
    noShow: number
    cancelled: number
    noShowRate: number
  }>
  leadHistogram: Array<{ label: string; count: number }>
  doctorUtilization: Array<{
    doctorId: string
    appts: number
    completed: number
    noShow: number
    completionRatePct: number
    chairHours: number
  }>
  confirmationFunnel: {
    total: number
    sent: number
    respondedYes: number
    respondedNo: number
    responseRatePct: number
    yesRatePct: number
  }
}

export async function getOperationalAppointments(periodQuery = '') {
  return api.get<AppointmentOperational>(`/api/analytics/operational/appointments${periodQuery}`)
}

// ── Operational: Lab ─────────────────────────────────────────────────────────

export interface LabOperational {
  generatedAt: string
  tiles: {
    activeCases: number
    completed90d: number
    delayed: number
    avgTurnaroundDays: number
    totalLabCost: number
    totalPatientCharge: number
    overallMargin: number
    overallMarginPct: number
    avgCostPerCase: number
  }
  funnel: Array<{ stage: string; count: number }>
  sideline: { delayed: number; cancelled: number }
  vendorPerformance: Array<{
    vendorId: string | null
    vendorName: string
    completed: number
    avgTurnaroundDays: number
    onTimeRate: number | null
    casesWithDeadline: number
  }>
  delayReasons: Array<{ reason: string; count: number }>
  domainMix: { internal: number; external: number }
  economicsByDomain: Array<{
    domain: string
    caseCount: number
    totalLabCost: number
    totalPatientCharge: number
    margin: number
    avgLabCost: number
    avgPatientCharge: number
    marginPct: number
  }>
  economicsMonthly: Array<{
    month: string
    caseCount: number
    avgLabCost: number
    avgPatientCharge: number
    marginPct: number
  }>
}

export async function getOperationalLab(periodQuery = '') {
  return api.get<LabOperational>(`/api/analytics/operational/lab${periodQuery}`)
}

// ── Operational: Inventory ───────────────────────────────────────────────────

export interface InventoryOperational {
  generatedAt: string
  tiles: {
    totalSkus: number
    lowStock: number
    expiringSoon: number
    expired: number
  }
  byCategory: Array<{ category: string; itemCount: number; totalUnits: number }>
  lowStock: Array<{
    id: string
    name: string
    category: string
    stockQuantity: number
    reorderLevel: number | null
  }>
  expiringSoon: Array<{
    id: string
    name: string
    category: string
    stockQuantity: number
    expiryDate: string
    daysLeft: number
  }>
}

export async function getOperationalInventory(periodQuery = '') {
  return api.get<InventoryOperational>(`/api/analytics/operational/inventory${periodQuery}`)
}

// ── Patient analytics ────────────────────────────────────────────────────────

export interface PatientAnalytics {
  generatedAt: string
  tiles: {
    totalPatients: number
    newThisMonth: number
    activeLast30d: number
    inactive12mo: number
    pwaEnabled: number
    pwaActive30d: number
    orthoCount: number
    childCount: number
  }
  acquisition: Array<{ month: string; count: number }>
  ltv: {
    histogram: Array<{ label: string; count: number }>
    median: number
    mean: number
    p90: number
    top10ShareOfRevenuePct: number
    payerCount: number
  }
  demographics: {
    ageHistogram: Array<{ label: string; count: number }>
    avgAge: number
    genderMix: Array<{ gender: string; count: number }>
  }
  mix: {
    category: Array<{ category: string; count: number }>
    orthoCount: number
    childCount: number
    orthoChildCount: number
  }
  inactiveList: Array<{
    id: string
    patientId: string
    name: string
    email: string | null
    phone: string | null
    createdAt: string
    lastVisit: string | null
    daysSinceLastVisit: number | null
  }>
}

export async function getPatientAnalytics(periodQuery = '') {
  return api.get<PatientAnalytics>(`/api/analytics/patient${periodQuery}`)
}

// ── Workforce analytics ──────────────────────────────────────────────────────

export interface WorkforceAnalytics {
  generatedAt: string
  headcount: {
    tiles: {
      total: number
      newHires12mo: number
      leavers12mo: number
      turnoverPct: number
      probationCount: number
      contractEndingCount: number
      credentialsExpiringCount: number
    }
    byPosition: Array<{ position: string; count: number }>
    tenureHistogram: Array<{ label: string; count: number }>
    probationEnding: Array<{
      id: string
      fullName: string
      probationEndDate: string | null
      daysLeft: number | null
    }>
    contractEnding: Array<{
      id: string
      fullName: string
      contractEndDate: string | null
      daysLeft: number | null
    }>
    credentialsExpiring: Array<{
      id: string
      staffId: string
      credentialType: string | null
      credentialName: string | null
      expiryDate: string | null
      daysLeft: number | null
    }>
  }
  attendance: {
    tiles: {
      attendanceRate: number
      latenessRate: number
      present: number
      late: number
      absent: number
      totalRecords: number
    }
    trend: Array<{
      day: string
      present: number
      absent: number
      late: number
      halfDay: number
      leave: number
    }>
  }
  payroll: {
    tiles: {
      latestNet: number
      latestGross: number
      grossToNetRatio: number
      totalNetYtd: number
      runCount: number
    }
    trend: Array<{
      id: string
      name: string
      payPeriodEnd: string
      totalGross: number
      totalNet: number
      totalPaye: number
      totalSsnit: number
      staffCount: number
    }>
  }
  training: {
    tiles: {
      totalMaterials: number
      mandatoryMaterials: number
      mandatoryComplianceRate: number
      avgPerformance: number
      perfRecords: number
    }
    materials: Array<{
      id: string
      title: string
      isMandatory: boolean
      assigned: number
      completed: number
      inProgress: number
      notStarted: number
      completionRate: number
      avgScore: number | null
    }>
    performanceHistogram: Array<{ label: string; count: number }>
  }
}

export async function getWorkforceAnalytics(periodQuery = '') {
  return api.get<WorkforceAnalytics>(`/api/analytics/workforce${periodQuery}`)
}

// ── Commission analytics ─────────────────────────────────────────────────────

export interface CommissionAnalytics {
  generatedAt: string
  tiles: {
    totalAccrued: number
    totalPayable: number
    totalPaid: number
    outstanding: number
    realizationLifetimePct: number
    payoutCount12mo: number
    totalWithholding12mo: number
    withholdingTaxPct: number
    avgPayoutCycleDays: number
    medianPayoutCycleDays: number
    activeSpecialistCount: number
  }
  funnel: Array<{ stage: string; amount: number }>
  perSpecialist: Array<{
    specialistId: string
    name: string
    specialty: string | null
    isActive: boolean
    accrued: number
    payable: number
    paid: number
    outstanding: number
    realizationPct: number
  }>
  trend: Array<{
    month: string
    accrued: number
    paid: number
    realizationPct: number
  }>
  topEarners: Array<{
    specialistId: string
    name: string
    specialty: string | null
    paidTotal: number
    paidCount: number
  }>
}

export async function getCommissionAnalytics(periodQuery = '') {
  return api.get<CommissionAnalytics>(`/api/analytics/commission${periodQuery}`)
}

// ── Clinical analytics ───────────────────────────────────────────────────────

export interface ClinicalAnalytics {
  generatedAt: string
  tiles: {
    totalPlans: number
    presented: number
    accepted: number
    completed: number
    declined: number
    acceptanceRatePct: number
    avgPlanValue: number
    medianPlanValue: number
    pendingRecords: number
    avgHoursPending: number
    maxHoursPending: number
    xrayTotal: number
    internalXrays: number
    externalXrays: number
    consentsTotal: number
    consents90d: number
    recareActive: number
    recareOverdue: number
  }
  funnel: Array<{ stage: string; count: number }>
  decided: { accepted: number; declined: number; inProgress: number; completed: number }
  byDoctor: Array<{
    doctorId: string
    name: string
    presented: number
    accepted: number
    declined: number
    total: number
    acceptanceRate: number
  }>
  planValueHistogram: Array<{ label: string; count: number }>
  /** Keyed by FDI tooth number → procedure count from treatmentPlanItems. */
  toothProcedureHeat: Record<number, number>
  toothProcedureMax: number
  /** Keyed by FDI tooth number → caries count from odontogram. */
  cariesByToothHeat: Record<number, number>
  cariesMax: number
  /** Keyed by FDI tooth number → { avg pocket depth in mm, sample count }. */
  pocketDepthHeat: Record<number, { avg: number; count: number }>
  pocketDepthMax: number
  xrayTrend: Array<{ month: string; count: number }>
  xrayBySource: Record<string, number>
  xrayByType: Array<{ type: string; count: number }>
}

export async function getClinicalAnalytics(periodQuery = '') {
  return api.get<ClinicalAnalytics>(`/api/analytics/clinical${periodQuery}`)
}

// ── Compliance analytics ─────────────────────────────────────────────────────

export interface ComplianceAnalytics {
  generatedAt: string
  tiles: {
    credentialsExpiring90d: number
    credentialsExpiring30d: number
    credentialsExpired: number
    credentialsSuspended: number
    staffDocsExpiring90d: number
    complianceDocsExpiring90d: number
    complianceDocsExpired: number
    auditEvents24h: number
    failedLogins24h: number
    failedLogins30d: number
    successLogins30d: number
    syncErrors7d: number
  }
  credentialsExpiring: Array<{
    id: string
    staffId: string
    credentialType: string | null
    credentialName: string | null
    expiryDate: string
    daysLeft: number
    severity: 'default' | 'warning' | 'danger'
  }>
  credentialsExpired: Array<{
    id: string
    staffId: string
    credentialType: string | null
    credentialName: string | null
    expiryDate: string
    daysAgo: number
  }>
  staffDocsExpiring: Array<{
    id: string
    staffId: string
    title: string | null
    documentType: string | null
    expiryDate: string
    daysLeft: number
  }>
  complianceDocsExpiring: Array<{
    id: string
    documentName: string
    category: string
    dateExpired: string
    daysLeft: number
  }>
  /** Daily zero-filled rows. Keys: day + each top module + 'other'. */
  auditTrend: Array<Record<string, string | number>>
  /** Top 5 module slugs that drive the stacked-area series. */
  auditModules: string[]
  /** All modules with counts (used for the ranked table). */
  moduleTotals: Array<{ module: string; count: number }>
  topEntities: Array<{
    module: string
    entityId: string | null
    entityName: string | null
    count: number
  }>
  softDeleteByModule: Array<{ module: string; count: number }>
  loginTrend: Array<{ day: string; failed: number; success: number }>
  syncErrors: Array<{
    id: string
    entityType: string
    entityId: string
    destination: string | null
    errorMessage: string | null
    syncedAt: string
  }>
}

export async function getComplianceAnalytics(periodQuery = '') {
  return api.get<ComplianceAnalytics>(`/api/analytics/compliance${periodQuery}`)
}

// ── Store / Supply Chain ─────────────────────────────────────────────────────

export interface StoreSuppliersAnalytics {
  generatedAt: string
  tiles: {
    totalAPOutstanding: number
    overdueAP: number
    dpo: number
    activeSuppliers: number
    topSupplierSharePct: number
    top5SharePct: number
  }
  apBuckets: Array<{ label: string; count: number; balance: number }>
  concentration: Array<{
    supplierId: string | null
    supplierName: string
    spend: number
    billCount: number
    share: number
  }>
  windowDays: number
}

export interface StoreExpensesAnalytics {
  generatedAt: string
  tiles: {
    totalExpense: number
    totalRevenue: number
    expenseToRevenuePct: number
    categoryCount: number
    topCategory: string | null
    topCategoryAmount: number
  }
  byCategory: Array<{ category: string; amount: number; count: number }>
  monthly: Array<{ month: string; expense: number; revenue: number; ratio: number }>
}

export interface StoreInventoryAgingAnalytics {
  generatedAt: string
  tiles: {
    totalSkusWithStock: number
    aged90: number
    aged180: number
    aged365: number
  }
  ageBuckets: Array<{ label: string; items: number; units: number }>
  agedItems: Array<{
    id: string
    name: string
    category: string | null
    stockQuantity: number
    daysOnHand: number
  }>
}

export async function getStoreSuppliers(periodQuery = '') {
  return api.get<StoreSuppliersAnalytics>(`/api/analytics/store/suppliers${periodQuery}`)
}

export async function getStoreExpenses(periodQuery = '') {
  return api.get<StoreExpensesAnalytics>(`/api/analytics/store/expenses${periodQuery}`)
}

export async function getStoreInventoryAging(periodQuery = '') {
  return api.get<StoreInventoryAgingAnalytics>(`/api/analytics/store/inventory-aging${periodQuery}`)
}

// ── CRM ──────────────────────────────────────────────────────────────────────

export interface CrmAnalytics {
  generatedAt: string
  tiles: {
    smsSent: number
    emailSent: number
    smsDeliveryRatePct: number
    recareActive: number
    recareDueNow: number
    recareCompletedInPeriod: number
    recareAdherencePct: number
    pwaEnabled: number
    pwaActiveInPeriod: number
    pwaEnableRatePct: number
    pwaActiveRatePct: number
    staffPushSubscribers: number
  }
  smsByType: Record<string, number>
  emailByType: Record<string, number>
  smsTrend: Array<{ day: string; count: number }>
  recareStatus: Record<string, number>
  templateUsage: Array<{
    templateId: string | null
    templateName: string
    sent: number
    total: number
    sendRatePct: number
  }>
  remindersByType: Array<{ type: string; count: number }>
  remindersByStatus: Array<{ status: string; count: number }>
  pwaFunnel: Array<{ stage: string; count: number }>
}

export async function getCrmAnalytics(periodQuery = '') {
  return api.get<CrmAnalytics>(`/api/analytics/crm${periodQuery}`)
}

// ── Insurance ────────────────────────────────────────────────────────────────

export interface InsuranceAnalytics {
  generatedAt: string
  tiles: {
    insuranceSharePct: number
    insuranceAmount: number
    oopAmount: number
    activeCompanies: number
    outstandingReconciliation: number
    outstandingReconciliationCount: number
    totalCharged: number
    totalPaid: number
  }
  methodMix: Array<{ method: string; amount: number; count: number; sharePct: number }>
  monthlyMix: Array<{ month: string; insurance: number; oop: number; insurancePct: number }>
  reconciliation: Array<{
    companyId: string
    companyName: string
    charged: number
    paid: number
    outstanding: number
    reconciledCount: number
    totalCount: number
    reconciliationRatePct: number
  }>
  pricingDocs: Array<{
    companyId: string
    companyName: string
    fileName: string
    version: string | null
    effectiveFrom: string | null
    uploadedAt: string | null
    isCurrent: boolean
  }>
}

export async function getInsuranceAnalytics(periodQuery = '') {
  return api.get<InsuranceAnalytics>(`/api/analytics/insurance${periodQuery}`)
}

// ── Insurance Claim Pipeline (Phase 3) ───────────────────────────────────────

export interface InsuranceClaimPipelineData {
  generatedAt: string
  tiles: {
    totalClaims: number
    totalCharged: number
    denialRatePct: number
    approvalRatePct: number
    pendingCount: number
    pendingAmount: number
  }
  funnel: Array<{ status: string; count: number; amount: number }>
  byCompany: Array<{
    companyId: string
    companyName: string
    totalClaims: number
    deniedClaims: number
    approvedClaims: number
    denialRatePct: number
    avgDaysToApproval: number | null
    totalCharged: number
    totalApproved: number
  }>
  monthlyTrend: Array<{ month: string; submitted: number; approved: number; denied: number }>
  claimAging: Array<{ bucket: string; count: number; amount: number }>
}

export async function getInsuranceClaimPipeline(periodQuery = '') {
  return api.get<InsuranceClaimPipelineData>(
    `/api/analytics/insurance/claim-pipeline${periodQuery}`
  )
}

// ── Data Integrity ───────────────────────────────────────────────────────────

export interface DataIntegrityAnalytics {
  generatedAt: string
  tiles: {
    totalRecordsSynced: number
    enabledRulesCount: number
    syncSuccessRatePct: number
    failures24h: number
    staleFailures: number
    activeInjectSections: number
  }
  syncByEntity: Array<{
    entityType: string
    success: number
    failed: number
    total: number
    successRatePct: number
  }>
  syncTrend: Array<{ day: string; success: number; failed: number }>
  topFailures: Array<{
    entityType: string
    errorMessage: string
    count: number
    lastFailedAt: string | null
  }>
  backlogAge: Array<{ label: string; count: number }>
  rules: Array<{
    entity: string
    enabled: boolean
    lastSyncedAt: string | null
    recordsSynced: number
  }>
  injectSections: Array<{ section: string; enabled: boolean; updatedAt: string | null }>
  injectAudit: Array<{
    id: string
    action: string
    entityName: string | null
    changes: unknown
    userId: string
    createdAt: string | null
  }>
  completeness: {
    patients: {
      total: number
      missingPhonePct: number
      missingEmailPct: number
      missingDobPct: number
      missingGenderPct: number
    }
    appointments: {
      total: number
      missingDoctorPct: number
      completedMissingTimestampsPct: number
    }
  }
  lateArrivals: Array<{ day: string; count: number }>
}

export async function getDataIntegrityAnalytics(periodQuery = '') {
  return api.get<DataIntegrityAnalytics>(`/api/analytics/data-integrity${periodQuery}`)
}

// ── Phase 2 extended endpoints ───────────────────────────────────────────────

export interface WorkforceExtendedAnalytics {
  generatedAt: string
  tiles: {
    totalEntitlementDays: number
    totalLeaveTaken: number
    overallLeaveUtilPct: number
    pendingLeaveRequests: number
    credExpired: number
    credExpires30: number
    credExpires60: number
    credExpires90: number
    credSuspended: number
    staffWithReview: number
    staffMissingReview: number
    reviewCoveragePct: number
  }
  leaveBalance: Array<{
    staffId: string
    fullName: string
    entitlement: number
    taken: number
    remaining: number
    utilisationPct: number
  }>
  credentialsRollingForward: Array<{
    id: string
    staffId: string
    credentialType: string | null
    credentialName: string | null
    expiryDate: string
    daysLeft: number
    bucket: 'expired' | '30' | '60' | '90' | 'beyond'
  }>
  trainingDeadlines: Array<{
    id: string
    title: string
    deadline: string | null
    daysLeft: number | null
    completedCount: number
    assignedCount: number
    completionPct: number
  }>
}
export async function getWorkforceExtended(periodQuery = '') {
  return api.get<WorkforceExtendedAnalytics>(`/api/analytics/workforce-extended${periodQuery}`)
}

export interface SpecialistExtendedAnalytics {
  generatedAt: string
  tiles: {
    totalSessions: number
    totalSpecialists: number
    overallNoShowPct: number
    overallRetentionPct: number
    totalReturningPatients: number
  }
  perSpecialist: Array<{
    specialistId: string
    name: string
    specialty: string | null
    isActive: boolean
    totalSessions: number
    completed: number
    noShow: number
    cancelled: number
    completionRatePct: number
    noShowRatePct: number
    patientCount: number
    returningCount: number
    retentionRatePct: number
  }>
}
export async function getSpecialistExtended(periodQuery = '') {
  return api.get<SpecialistExtendedAnalytics>(`/api/analytics/specialist-extended${periodQuery}`)
}

export interface ClinicalExtendedAnalytics {
  generatedAt: string
  tiles: {
    totalProcedureItems: number
    totalProcedureCompleted: number
    overallProcedureCompletionPct: number
    overallAvgPocketDepth: number
    prescriptionCount: number
    medicalRecordCompletenessPct: number
    completedAppts: number
    completedApptsWithRecord: number
  }
  procedureByDoctor: Array<{
    doctorUserId: string | null
    doctorName: string | null
    totalItems: number
    completed: number
    totalEstimated: number
    completionRatePct: number
  }>
  perioMonthly: Array<{
    month: string
    avgPocketDepth: number
    patientCount: number
    measurementCount: number
  }>
  prescriptionMonthly: Array<{ month: string; count: number }>
  prescriptionTop: Array<{ medication: string; count: number }>
}
export async function getClinicalExtended(periodQuery = '') {
  return api.get<ClinicalExtendedAnalytics>(`/api/analytics/clinical-extended${periodQuery}`)
}
