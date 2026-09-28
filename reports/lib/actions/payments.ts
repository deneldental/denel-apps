import { api } from '@/lib/api-client'
import type { payments } from '@/lib/db/schema'

export async function getPayments() {
  const res = await api.get<any[]>('/api/payments')
  return { success: res.success, data: res.data || [], error: res.error }
}

export async function getPaymentsByPatientId(patientId: string) {
  const res = await api.get<any[]>(`/api/payments/patient/${patientId}`)
  return { success: res.success, data: res.data || [], error: res.error }
}

export async function createPayment(data: typeof payments.$inferInsert) {
  const res = await api.post<any>('/api/payments', data)
  return res
}

export async function updatePayment(id: string, data: Partial<typeof payments.$inferInsert>) {
  const res = await api.patch<any>(`/api/payments/${id}`, data)
  return res
}

export async function deletePayment(id: string) {
  const res = await api.delete<any>(`/api/payments/${id}`)
  return res
}
