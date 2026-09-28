import { api } from '@/lib/api-client'

const TYPE = 'appointment-types'

export async function getAppointmentTypes() {
  return api.get<any[]>(`/api/lookups/${TYPE}`)
}

export async function getAllAppointmentTypes() {
  return api.get<any[]>(`/api/lookups/${TYPE}/all`)
}

export async function createAppointmentType(data: {
  name: string
  displayName?: string
  colour?: string
}) {
  const res = await api.post<any>(`/api/lookups/${TYPE}`, data)
  return res
}

export async function toggleAppointmentTypeActive(id: string, isActive: boolean) {
  const res = await api.patch<any>(`/api/lookups/${TYPE}/${id}`, { isActive })
  return res
}

export async function updateAppointmentType(
  id: string,
  data: { name?: string; displayName?: string; colour?: string }
) {
  const res = await api.patch<any>(`/api/lookups/${TYPE}/${id}`, data)
  return res
}

export async function deleteAppointmentType(id: string) {
  const res = await api.delete<any>(`/api/lookups/${TYPE}/${id}`)
  return res
}
