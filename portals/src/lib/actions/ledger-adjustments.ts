import type { ApiResponse } from '@/lib/api-client'
import { api } from '@/lib/api-client'

export type LedgerPatient = {
  id: string
  name: string
  phone: string | null
}

export type PlanPayment = {
  id: string
  amount: number
  method: string
  description: string | null
  createdAt: string
  balance: number | null
  paymentPlanId: string | null
}

export type PlanDetails = {
  plan: {
    id: string
    patientId: string
    totalAmount: number
    amountPerInstallment: number | null
    paymentFrequency: string | null
    status: string
    startDate: string
    notes: string | null
    type: string
  }
  payments: PlanPayment[]
  totalPaid: number
  remaining: number
}

export type AdjustmentPayment = {
  id: string
  patientId: string
  paymentPlanId: string | null
  amount: number
  method: string
  status: string
  description: string | null
  balance: number | null
  createdAt: string
}

export async function getLedgerPatients(): Promise<ApiResponse<LedgerPatient[]>> {
  return api.get('/api/ledger-adjustments/patients')
}

export async function getPatientPlanDetails(
  patientId: string
): Promise<ApiResponse<PlanDetails | null>> {
  return api.get(`/api/ledger-adjustments/patient/${patientId}/plan`)
}

export async function getRecentAdjustments(): Promise<ApiResponse<AdjustmentPayment[]>> {
  return api.get('/api/ledger-adjustments/recent')
}

export type OneTimePayment = {
  id: string
  patientId: string
  amount: number
  method: string
  status: string
  description: string | null
  createdAt: string
  treatments: Array<{ treatmentId: string; name: string; amount: number }> | null
}

export async function getPatientOneTimePayments(
  patientId: string
): Promise<ApiResponse<OneTimePayment[]>> {
  return api.get(`/api/ledger-adjustments/patient/${patientId}/one-time-payments`)
}

export async function transferPaymentToPlan(data: {
  paymentId: string
  patientId: string
}): Promise<ApiResponse<{ planCompleted: boolean; newBalance: number; planId: string }>> {
  return api.post('/api/ledger-adjustments/transfer-to-plan', data)
}

export async function createOneTimeAdjustment(data: {
  patientId: string
  amount: number
  method: string
  description?: string
  transactionDate: string
  reason?: string
  treatments?: any[]
}): Promise<ApiResponse<AdjustmentPayment>> {
  return api.post('/api/ledger-adjustments/one-time', data)
}

export async function createPlanInstallmentAdjustment(data: {
  patientId: string
  amount: number
  method: string
  description?: string
  transactionDate: string
  reason?: string
  treatments?: any[]
}): Promise<
  ApiResponse<{
    payment: AdjustmentPayment
    planCompleted: boolean
    newBalance: number
    planId: string
  }>
> {
  return api.post('/api/ledger-adjustments/plan-installment', data)
}

export async function createLedgerExpense(data: {
  category: string
  amount: number
  date: string
  description?: string
  paidTo?: string
  paymentMethod?: string
  reason?: string
  attachmentUrl?: string
}): Promise<ApiResponse<{ id: string }>> {
  return api.post('/api/ledger-adjustments/expense', data)
}

export async function importBulkExpenses(
  formData: FormData
): Promise<ApiResponse<{ message: string; errors?: string[] }>> {
  return api.post('/api/ledger-adjustments/expense-bulk', formData)
}

export async function importBulkPayments(
  formData: FormData
): Promise<ApiResponse<{ message: string; errors?: string[] }>> {
  return api.post('/api/ledger-adjustments/payment-bulk', formData)
}

export async function quickCreatePatients(names: string[]): Promise<
  ApiResponse<{
    message: string
    created: { id: string; name: string; patientId: string }[]
    skipped: string[]
  }>
> {
  return api.post('/api/ledger-adjustments/quick-create-patients', { names })
}
