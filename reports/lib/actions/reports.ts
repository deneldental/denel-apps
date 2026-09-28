import { api } from '@/lib/api-client'

export async function getDailyReports() {
  const res = await api.get<any[]>('/api/reports')
  return { success: res.success, data: res.data || [], error: res.error }
}

export async function createDailyReport(data: any) {
  const res = await api.post<any>('/api/reports', data)
  return res
}

export async function getDailyReportById(id: string) {
  const res = await api.get<any>(`/api/reports/${id}`)
  return { success: res.success, data: res.data, error: res.error }
}

export async function deleteDailyReport(id: string) {
  const res = await api.delete<any>(`/api/reports/${id}`)
  return res
}
