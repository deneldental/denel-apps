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

/**
 * Reverse a posted payment (POST /api/payments/:id/reverse).
 *
 * Posts a reversing journal entry, rolls back invoice balances + any wallet
 * credit, and flips the payment to `reversed`. Backend rejects anything that
 * isn't currently `posted` (draft / already-reversed → 400). Typed against the
 * actual `{ payment, reversal }` response so callers can surface the reversal
 * entry number in a toast.
 */
export async function reversePayment(id: string, reason: string) {
  return api.post<{
    payment: { id: string; paymentNumber: string | null; status: string }
    reversal: { id: string; entryNumber: string }
  }>(`/api/payments/${id}/reverse`, { reason })
}
