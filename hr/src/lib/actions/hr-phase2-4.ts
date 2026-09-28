/**
 * Frontend actions for the Phase 2/3/4 HR endpoints.
 *
 * Backend lives in backend/src/routes/hr-phase2.ts,
 * backend/src/routes/hr-phase3-4.ts, and backend/src/routes/payroll.ts.
 * Each helper returns the raw `ApiResponse` so callers can branch on success.
 */

import { API_BASE_URL, api } from '@/lib/api-client'

// ── Org chart ───────────────────────────────────────────────────────────────

export type OrgChartNode = {
  id: string
  fullName: string
  position: string | null
  profileImage: string | null
  managerId: string | null
  staffType: 'internal' | 'external'
}

export function getOrgChart() {
  return api.get<OrgChartNode[]>('/api/hr/org-chart')
}

export function setManager(staffId: string, managerId: string | null) {
  return api.patch(`/api/hr/staff/${staffId}/manager`, { managerId })
}

// ── Lifecycle tasks ─────────────────────────────────────────────────────────

export type LifecycleTask = {
  id: string
  staffId: string
  kind: 'onboarding' | 'offboarding' | 'probation_review' | 'contract_renewal'
  taskKey: string
  label: string
  description: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'skipped'
  dueAt: string | null
  completedAt: string | null
  notes: string | null
  overdue?: boolean
  staffName?: string
}

export function instantiateLifecycle(staffId: string, kind: LifecycleTask['kind']) {
  return api.post(`/api/hr/staff/${staffId}/lifecycle/${kind}`, {})
}

export function getLifecycleTasks(staffId: string) {
  return api.get<LifecycleTask[]>(`/api/hr/staff/${staffId}/lifecycle`)
}

export function updateLifecycleTask(
  taskId: string,
  patch: Partial<{
    status: LifecycleTask['status']
    notes: string
    assigneeUserId: string | null
    dueAt: string | null
  }>
) {
  return api.patch(`/api/hr/lifecycle/${taskId}`, patch)
}

export function getActiveLifecycleTasks() {
  return api.get<LifecycleTask[]>('/api/hr/lifecycle/active')
}

// ── Compensation ────────────────────────────────────────────────────────────

export type CompensationRow = {
  id: string
  staffId: string
  effectiveFrom: string
  effectiveTo: string | null
  baseAmount: string
  currency: string
  jobGradeId: string | null
  reason: string | null
  notes: string | null
}

export function getCompensation(staffId: string) {
  return api.get<CompensationRow[]>(`/api/hr/staff/${staffId}/compensation`)
}

export function recordCompensation(
  staffId: string,
  body: {
    baseAmount: number
    effectiveFrom: string
    currency?: string
    jobGradeId?: string | null
    reason?: string
    notes?: string
  }
) {
  return api.post(`/api/hr/staff/${staffId}/compensation`, body)
}

// ── Payroll ─────────────────────────────────────────────────────────────────

export type PayrollRun = {
  id: string
  name: string
  payPeriodStart: string
  payPeriodEnd: string
  status: 'draft' | 'locked' | 'published' | 'archived'
  totalGross: string | null
  totalNet: string | null
  totalPaye: string | null
  totalSsnit: string | null
  staffCount: number
  createdAt: string
  publishedAt: string | null
  // HR-H9: set once the run's net pay has actually been disbursed (DR Net
  // Salaries Payable / CR Bank). null = published but not yet paid out.
  disbursedAt: string | null
}

export function getPayrollRuns() {
  return api.get<PayrollRun[]>('/api/payroll/runs')
}

export function deletePayrollRun(runId: string) {
  return api.delete(`/api/payroll/runs/${runId}`)
}

export function createPayrollRun(body: {
  name: string
  payPeriodStart: string
  payPeriodEnd: string
  includeStaffIds?: string[]
}) {
  return api.post<{
    runId: string
    staffCount: number
    totalGross: number
    totalNet: number
    totalPaye: number
    totalSsnit: number
  }>('/api/payroll/runs', body)
}

export function publishPayrollRun(runId: string) {
  return api.post<{
    glPosted: boolean
    glReason?: string
    glRedated?: boolean
    glPostedDate?: string | null
  }>(`/api/payroll/runs/${runId}/publish`, {})
}

export function rerunPayrollRun(runId: string) {
  return api.post<{
    runId: string
    staffCount: number
    totalGross: number
    totalNet: number
    totalPaye: number
    totalSsnit: number
  }>(`/api/payroll/runs/${runId}/rerun`, {})
}

// HR-H9: disburse a published run (DR Net Salaries Payable / CR Bank).
export function disbursePayrollRun(runId: string) {
  return api.post<{ journalEntryId: string }>(`/api/payroll/runs/${runId}/pay`, {})
}

export type PayrollRunDetailRow = {
  id: string
  staffId: string
  staffName: string | null
  staffCode: string | null
  basicSalary: number
  allowances: number
  overtime: number
  grossPay: number
  netPay: number
  paye: number
  ssnitTier1: number
  ssnitTier2: number
  totalEmployerCost: number
}

export function getPayrollRunDetails(runId: string) {
  return api.get<{ run: PayrollRun; rows: PayrollRunDetailRow[] }>(
    `/api/payroll/runs/${runId}/details`
  )
}

export type SalaryComponent = {
  id: string
  type: 'basic' | 'allowance' | 'deduction' | 'bonus' | 'overtime' | 'reimbursement'
  name: string
  amount: string
  taxable: boolean
  effectiveFrom: string
  effectiveTo: string | null
}

export function getSalaryComponents(staffId: string) {
  return api.get<SalaryComponent[]>(`/api/payroll/staff/${staffId}/components`)
}

export function addSalaryComponent(
  staffId: string,
  body: {
    type: SalaryComponent['type']
    name: string
    amount: number
    taxable?: boolean
    currency?: string
    effectiveFrom?: string
  }
) {
  return api.post(`/api/payroll/staff/${staffId}/components`, body)
}

export function deleteSalaryComponent(componentId: string) {
  return api.delete(`/api/payroll/components/${componentId}`)
}

// ── Payslip admin ───────────────────────────────────────────────────────────

export function deletePayslip(id: string) {
  return api.delete(`/api/staff/payslips/${id}`)
}

export function unlinkPayslip(id: string) {
  return api.patch(`/api/payroll/payslips/${id}/unlink`, {})
}

export function relinkPayslip(id: string) {
  return api.patch<{ payrollRunId: string }>(`/api/payroll/payslips/${id}/relink`, {})
}

// ── Goals + 1:1 notes ───────────────────────────────────────────────────────

export type StaffGoal = {
  id: string
  staffId: string
  cycleId: string | null
  title: string
  description: string | null
  category: string | null
  targetDate: string | null
  status: 'open' | 'in_progress' | 'completed' | 'cancelled'
  progressPercent: number
  outcomeNotes: string | null
  createdAt: string
}

export function getStaffGoals(staffId: string) {
  return api.get<StaffGoal[]>(`/api/hr/staff/${staffId}/goals`)
}

export function createStaffGoal(
  staffId: string,
  body: {
    title: string
    description?: string
    category?: string
    targetDate?: string
    cycleId?: string | null
  }
) {
  return api.post(`/api/hr/staff/${staffId}/goals`, body)
}

export function updateStaffGoal(
  goalId: string,
  body: Partial<{
    title: string
    description: string
    status: StaffGoal['status']
    progressPercent: number
    outcomeNotes: string
    targetDate: string | null
  }>
) {
  return api.patch(`/api/hr/goals/${goalId}`, body)
}

export type OneOnOneNote = {
  id: string
  staffId: string
  managerUserId: string
  meetingDate: string
  agenda: string | null
  notes: string | null
  actionItems: Array<{ description: string; owner?: string; dueAt?: string; done?: boolean }>
  privateNote: boolean
  createdAt: string
}

export function getOneOnOneNotes(staffId: string) {
  return api.get<OneOnOneNote[]>(`/api/hr/staff/${staffId}/one-on-ones`)
}

export function createOneOnOneNote(
  staffId: string,
  body: {
    meetingDate: string
    agenda?: string
    notes?: string
    actionItems?: OneOnOneNote['actionItems']
    privateNote?: boolean
  }
) {
  return api.post(`/api/hr/staff/${staffId}/one-on-ones`, body)
}

// ── Review cycles ──────────────────────────────────────────────────────────

export type ReviewCycle = {
  id: string
  name: string
  cycleType: 'monthly' | 'quarterly' | 'semiannual' | 'annual'
  startDate: string
  endDate: string
  status: 'draft' | 'active' | 'closed'
  createdAt: string
}

export function getReviewCycles() {
  return api.get<ReviewCycle[]>('/api/hr/review-cycles')
}

export function createReviewCycle(body: {
  name: string
  cycleType?: string
  startDate: string
  endDate: string
  participantStaffIds?: string[]
}) {
  return api.post<ReviewCycle>('/api/hr/review-cycles', body)
}

export function setReviewCycleStatus(cycleId: string, status: 'draft' | 'active' | 'closed') {
  return api.patch(`/api/hr/review-cycles/${cycleId}/status`, { status })
}

// ── Shifts + roster (Phase 3B) ─────────────────────────────────────────────

export type Shift = {
  id: string
  name: string
  startTime: string
  endTime: string
  weekdays: number[]
  color: string | null
}

export type ShiftAssignment = {
  id: string
  shiftId: string
  staffId: string
  date: string
  status: 'scheduled' | 'completed' | 'no_show' | 'swapped'
  notes: string | null
  shiftName: string
  shiftStart: string
  shiftEnd: string
  shiftColor: string | null
  staffName: string
}

export function getShifts() {
  return api.get<Shift[]>('/api/hr3/shifts')
}

export function createShift(body: {
  name: string
  startTime: string
  endTime: string
  weekdays?: number[]
  color?: string
}) {
  return api.post<Shift>('/api/hr3/shifts', body)
}

export function getRoster(from: string, to: string) {
  const qs = new URLSearchParams({ from, to }).toString()
  return api.get<ShiftAssignment[]>(`/api/hr3/roster?${qs}`)
}

export function assignRoster(
  assignments: Array<{ shiftId: string; staffId: string; date: string; notes?: string }>
) {
  return api.post<{ inserted: number }>('/api/hr3/roster', { assignments })
}

// ── Credential verification ────────────────────────────────────────────────

export function verifyCredential(
  credentialId: string,
  body: {
    method: 'manual_check' | 'phone_to_issuer' | 'online_registry' | 'document_only'
    notes?: string
  }
) {
  return api.post(`/api/hr3/credentials/${credentialId}/verify`, body)
}

export type CredentialDocument = {
  id: string
  credentialId: string
  versionNumber: number
  documentUrl: string
  issueDate: string | null
  expiryDate: string | null
  uploadedAt: string
  notes: string | null
}

export function getCredentialDocuments(credentialId: string) {
  return api.get<CredentialDocument[]>(`/api/hr3/credentials/${credentialId}/documents`)
}

export function addCredentialDocument(
  credentialId: string,
  body: { documentUrl: string; issueDate?: string; expiryDate?: string; notes?: string }
) {
  return api.post<{ versionNumber: number }>(`/api/hr3/credentials/${credentialId}/documents`, body)
}

// ── Bundle composition (Phase 4B) ──────────────────────────────────────────

export function setBundleParent(bundleId: string, parentBundleId: string | null) {
  return api.patch(`/api/hr3/bundles/${bundleId}/parent`, { parentBundleId })
}

// ── Audit / compliance exports ─────────────────────────────────────────────

export function downloadAuditReportUrl(from: string, to: string, module?: string) {
  const qs = new URLSearchParams({ from, to, format: 'csv' })
  if (module) qs.set('module', module)
  return `${API_BASE_URL}/api/hr3/audit-report?${qs.toString()}`
}

export function downloadCredentialsComplianceUrl() {
  return `${API_BASE_URL}/api/hr3/credentials/compliance-report?format=csv`
}
