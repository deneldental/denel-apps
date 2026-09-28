import { api } from '@/lib/api-client'

const TYPE = 'payment-methods'

export async function getPaymentMethods() {
  return api.get<any[]>(`/api/lookups/${TYPE}`)
}

export async function getAllPaymentMethods() {
  return api.get<any[]>(`/api/lookups/${TYPE}/all`)
}

export async function createPaymentMethod(data: { name: string; displayName?: string }) {
  const res = await api.post<any>(`/api/lookups/${TYPE}`, data)
  return res
}

export async function togglePaymentMethodActive(id: string, isActive: boolean) {
  const res = await api.patch<any>(`/api/lookups/${TYPE}/${id}`, { isActive })
  return res
}

export async function updatePaymentMethod(
  id: string,
  data: { name: string; displayName?: string }
) {
  const res = await api.patch<any>(`/api/lookups/${TYPE}/${id}`, data)
  return res
}

export async function deletePaymentMethod(id: string) {
  const res = await api.delete<any>(`/api/lookups/${TYPE}/${id}`)
  return res
}
