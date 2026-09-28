import { api } from '@/lib/api-client'
import type { appointments } from '@/lib/db/schema'

export type AppointmentListParams = {
  from?: Date | string
  to?: Date | string
  patientId?: string
  doctorId?: string
  limit?: number
  offset?: number
}

export type AppointmentListPage<T = any> = {
  success: boolean
  data: T[]
  total: number
  error?: string
}

export async function getAppointments(params: AppointmentListParams = {}) {
  const search = new URLSearchParams()
  if (params.from) {
    const d = typeof params.from === 'string' ? params.from : params.from.toISOString()
    search.set('from', d)
  }
  if (params.to) {
    const d = typeof params.to === 'string' ? params.to : params.to.toISOString()
    search.set('to', d)
  }
  if (params.patientId) search.set('patientId', params.patientId)
  if (params.doctorId) search.set('doctorId', params.doctorId)
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  if (params.offset !== undefined) search.set('offset', String(params.offset))
  const qs = search.toString()
  return api.get<any[]>(`/api/appointments${qs ? `?${qs}` : ''}`)
}

/** Paginated variant. Returns total + data shape suitable for server-driven tables. */
export async function getAppointmentsPage<T = any>(
  params: AppointmentListParams & { limit: number; offset?: number }
): Promise<AppointmentListPage<T>> {
  const res = await getAppointments(params)
  const raw = res as any
  return {
    success: res.success,
    data: (res.data as T[]) || [],
    total: typeof raw.total === 'number' ? raw.total : 0,
    error: res.error,
  }
}

export async function createAppointment(
  data: typeof appointments.$inferInsert,
  sendSMS: boolean = false,
  dateStr?: string,
  timeStr?: string,
  sendDoctorEmail: boolean = false
) {
  const res = await api.post<any>('/api/appointments', {
    data,
    sendSMS,
    dateStr,
    timeStr,
    sendDoctorEmail,
  })
  return res
}

export async function updateAppointment(
  id: string,
  data: Partial<typeof appointments.$inferInsert>,
  sendSMS: boolean = false,
  overrideReason?: string
) {
  const body: Record<string, unknown> = { data, sendSMS }
  if (overrideReason) body.overrideReason = overrideReason
  const res = await api.patch<any>(`/api/appointments/${id}`, body)
  return res
}

export async function deleteAppointment(id: string, overrideReason?: string) {
  const qs = overrideReason ? `?reason=${encodeURIComponent(overrideReason)}` : ''
  const res = await api.delete<any>(`/api/appointments/${id}${qs}`)
  return res
}
