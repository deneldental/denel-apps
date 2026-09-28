import { api } from '@/lib/api-client'

export async function getDoctorUnavailability(doctorId?: string) {
  return api.get<any[]>(`/api/doctors/unavailability${doctorId ? `?doctorId=${doctorId}` : ''}`)
}

export async function createUnavailability(data: {
  doctorId: string
  startTime: string
  endTime: string
  reason?: string | null
}) {
  const res = await api.post<{ id: string }>('/api/doctors/unavailability', data)
  return res
}

export async function deleteUnavailability(id: string) {
  const res = await api.delete<any>(`/api/doctors/unavailability/${id}`)
  return res
}
