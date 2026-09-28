import { api } from '@/lib/api-client'
import type { paymentPlans } from '@/lib/db/schema'

export async function getPaymentPlanByPatientId(patientId: string) {
  const res = await api.get<any>(`/api/payment-plans/patient/${patientId}`)
  return { success: res.success, data: res.data, error: res.error }
}

export async function getAllPaymentPlans() {
  const res = await api.get<any[]>('/api/payment-plans')
  return { success: res.success, data: res.data || [], error: res.error }
}

export async function createPaymentPlan(data: typeof paymentPlans.$inferInsert) {
  const res = await api.post<any>('/api/payment-plans', data)
  return res
}

export async function pausePaymentPlan(id: string) {
  const res = await api.post<any>(`/api/payment-plans/${id}/pause`, {})
  return res
}

export async function unpausePaymentPlan(id: string) {
  const res = await api.post<any>(`/api/payment-plans/${id}/unpause`, {})
  return res
}

export async function updatePaymentPlan(
  id: string,
  data: Partial<typeof paymentPlans.$inferInsert>
) {
  const res = await api.patch<any>(`/api/payment-plans/${id}`, data)
  return res
}

export async function deletePaymentPlan(id: string) {
  const res = await api.delete<any>(`/api/payment-plans/${id}`)
  return res
}

export async function getOverduePaymentPlans() {
  const res = await api.get<any[]>('/api/payment-plans/overdue')
  return res.data || []
}

export async function getOutstandingPaymentPlans() {
  const res = await api.get<any[]>('/api/payment-plans/outstanding')
  return res.data || []
}

export async function getPaymentPlanDetails(id: string) {
  const res = await api.get<any>(`/api/payment-plans/${id}`)
  return res.data
}

export async function updatePaymentAmount(paymentId: string, newAmount: number) {
  const res = await api.patch<any>(`/api/payments/${paymentId}`, { amount: newAmount })
  return res
}
