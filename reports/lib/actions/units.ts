import { api } from '@/lib/api-client'

const TYPE = 'units'

export async function getUnits() {
  return api.get<any[]>(`/api/lookups/${TYPE}`)
}

export async function getAllUnits() {
  return api.get<any[]>(`/api/lookups/${TYPE}/all`)
}

export async function createUnit(data: { name: string; displayName?: string }) {
  const res = await api.post<any>(`/api/lookups/${TYPE}`, data)
  return res
}

export async function toggleUnitActive(id: string, isActive: boolean) {
  const res = await api.patch<any>(`/api/lookups/${TYPE}/${id}`, { isActive })
  return res
}

export async function updateUnit(id: string, data: { name: string; displayName?: string }) {
  const res = await api.patch<any>(`/api/lookups/${TYPE}/${id}`, data)
  return res
}

export async function deleteUnit(id: string) {
  const res = await api.delete<any>(`/api/lookups/${TYPE}/${id}`)
  return res
}
