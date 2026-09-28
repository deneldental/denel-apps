import { api } from '@/lib/api-client'
import type { appointments } from '@/lib/db/schema'

export async function getAppointments() {
  return api.get<any[]>('/api/appointments')
}

export async function createAppointment(
  data: typeof appointments.$inferInsert,
  sendSMS: boolean = false,
  dateStr?: string,
  timeStr?: string
) {
  const queryParams = new URLSearchParams()
  if (sendSMS) queryParams.append('sendSMS', 'true')
  if (dateStr) queryParams.append('dateStr', dateStr)
  if (timeStr) queryParams.append('timeStr', timeStr)

  const res = await api.post<any>(`/api/appointments?${queryParams.toString()}`, data)
  return res
}

export async function updateAppointment(
  id: string,
  data: Partial<typeof appointments.$inferInsert>,
  sendSMS: boolean = false
) {
  const queryParams = new URLSearchParams()
  if (sendSMS) queryParams.append('sendSMS', 'true')

  const res = await api.patch<any>(`/api/appointments/${id}?${queryParams.toString()}`, data)
  return res
}

export async function deleteAppointment(id: string) {
  const res = await api.delete<any>(`/api/appointments/${id}`)
  return res
}
