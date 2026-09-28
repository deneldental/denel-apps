import { api } from '@/lib/api-client'

export async function getTreatmentTypes() {
  return api.get<any[]>('/api/treatments')
}

export async function getAllTreatmentTypes() {
  return api.get<any[]>('/api/treatments/all')
}

export async function createTreatmentType(data: { name: string; displayName?: string }) {
  const res = await api.post<any>('/api/treatments', data)
  return res
}

export async function toggleTreatmentTypeActive(id: string, isActive: boolean) {
  const res = await api.patch<any>(`/api/treatments/${id}`, { isActive })
  return res
}

export async function updateTreatmentType(
  id: string,
  data: { name: string; displayName?: string }
) {
  const res = await api.patch<any>(`/api/treatments/${id}`, data)
  return res
}

export async function deleteTreatmentType(id: string) {
  const res = await api.delete<any>(`/api/treatments/${id}`)
  return res
}
