import { api } from '@/lib/api-client'

export interface LabExpenseReadyCase {
  id: string
  caseNumber: string
  serviceName: string
  labCost: number | null
  cost: number | null
  expenseReadyAt: string
  externalExpenseId: string | null
  patient?: { id: string; name: string } | null
  externalPatientName: string | null
  vendor?: { id: string; name: string; type: 'internal' | 'external' }
}

/**
 * Cases that have crossed the patient-payment threshold (or 2-week fallback)
 * and still owe the lab. Daily-report-form uses this to block submission
 * until each is cleared as an expense.
 */
export async function getLabExpenseReadyCases() {
  const res = await api.get<LabExpenseReadyCase[]>('/api/labs/cases/expense-ready')
  return { success: res.success, data: res.data ?? [], error: res.error }
}

/** Receptionist confirms paying the lab. Records the expense + marks the case cleared. */
export async function clearLabExpense(
  caseId: string,
  body: { amount: number; paymentMethod?: string | null; date?: string }
) {
  return api.post<{ expense: { id: string; amount: number }; caseId: string }>(
    `/api/labs/cases/${caseId}/clear-expense`,
    body
  )
}
