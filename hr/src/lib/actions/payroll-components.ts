// PR-22 — salary components (allowances / bonuses / deductions) CRUD plus
// the read path for the active PAYE bracket schedule. The payroll-runs
// page and the new Compensation step on the staff profile both lean on
// these. Wraps the existing /api/payroll/staff/:id/components endpoints.

import { api } from '@/lib/api-client'

export type SalaryComponentType =
  | 'basic'
  | 'allowance'
  | 'deduction'
  | 'bonus'
  | 'overtime'
  | 'reimbursement'

export type SalaryComponent = {
  id: string
  staffId: string
  type: SalaryComponentType
  name: string
  amount: string // numeric serialized to string by drizzle
  currency: string
  taxable: boolean
  taxConfigId: string | null
  effectiveFrom: string
  effectiveTo: string | null
  createdAt: string
  updatedAt: string
}

export type TaxConfig = {
  id: string
  taxType: string
  rate: number
  applicableTo: string
  isActive: boolean
  notes: string | null
}

export async function listSalaryComponents(staffId: string) {
  return api.get<SalaryComponent[]>(`/api/payroll/staff/${staffId}/components`)
}

export async function createSalaryComponent(
  staffId: string,
  input: {
    type: SalaryComponentType
    name: string
    amount: number
    currency?: string
    taxable?: boolean
    taxConfigId?: string | null
    effectiveFrom?: string
  }
) {
  return api.post<SalaryComponent>(`/api/payroll/staff/${staffId}/components`, input)
}

export async function listTaxConfigurations() {
  return api.get<TaxConfig[]>('/api/tax-configurations')
}

export async function deleteSalaryComponent(componentId: string) {
  return api.delete<{ success: true }>(`/api/payroll/components/${componentId}`)
}

// ── Tax brackets (read-only, PR-22) ───────────────────────────────────────

export type TaxBracketRow = {
  id: string
  bracketYear: number
  taxType: 'paye' | 'ssnit_employee' | 'ssnit_employer' | string
  lowerBoundMonthly: string | number
  upperBoundMonthly: string | number | null
  ratePercent: string | number
  isActive: boolean
}

export type TaxBracketsResponse = {
  year: number
  rows: TaxBracketRow[]
}

export async function getTaxBrackets(year?: number) {
  const qs = year ? `?year=${year}` : ''
  return api.get<TaxBracketsResponse>(`/api/payroll/tax-brackets${qs}`)
}

// ── Tax bracket CRUD (PR-24) ──────────────────────────────────────────────

export async function createTaxBracket(input: {
  bracketYear: number
  taxType: 'paye' | 'ssnit_employee' | 'ssnit_employer'
  lowerBoundMonthly: number
  upperBoundMonthly: number | null
  ratePercent: number
  isActive?: boolean
}) {
  return api.post<TaxBracketRow>('/api/payroll/tax-brackets', input)
}

export async function updateTaxBracket(
  id: string,
  input: Partial<{
    lowerBoundMonthly: number
    upperBoundMonthly: number | null
    ratePercent: number
    isActive: boolean
  }>
) {
  return api.patch<TaxBracketRow>(`/api/payroll/tax-brackets/${id}`, input)
}

export async function deleteTaxBracket(id: string) {
  return api.delete<{ success: true }>(`/api/payroll/tax-brackets/${id}`)
}

export async function seedTaxBracketsFromDefaults(bracketYear: number, replace = false) {
  return api.post<{ inserted: number; year: number }>('/api/payroll/tax-brackets/seed', {
    bracketYear,
    replace,
  })
}

// ── Staff loans (§4.3) ────────────────────────────────────────────────────────

export type StaffLoan = {
  id: string
  staffId: string
  description: string
  principalAmount: string
  remainingBalance: string
  monthlyInstallment: string
  startDate: string
  status: 'active' | 'settled' | 'paused'
  notes: string | null
  createdAt: string
  updatedAt: string
}

export async function listStaffLoans(staffId: string) {
  return api.get<StaffLoan[]>(`/api/payroll/staff/${staffId}/loans`)
}

export async function createStaffLoan(
  staffId: string,
  input: {
    description?: string
    principalAmount: number
    monthlyInstallment: number
    startDate: string
    notes?: string
  }
) {
  return api.post<StaffLoan>(`/api/payroll/staff/${staffId}/loans`, input)
}

export async function updateStaffLoan(
  loanId: string,
  input: { status?: 'active' | 'settled' | 'paused'; monthlyInstallment?: number; notes?: string }
) {
  return api.patch<StaffLoan>(`/api/payroll/loans/${loanId}`, input)
}
