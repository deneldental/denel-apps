import { api } from '@/lib/api-client'

export async function getDashboardStats(period: 'day' | 'week' | 'month' = 'month') {
  const res = await api.get<any>(`/api/dashboard/stats?period=${period}`)
  return res.data
}

export async function getDoctorDashboardStats() {
  const res = await api.get<any>('/api/dashboard/doctor/stats')
  return res.data
}

export async function getReceptionistDashboardStats(period: 'day' | 'week' | 'month' = 'day') {
  const res = await api.get<any>(`/api/dashboard/receptionist/stats?period=${period}`)
  return res.data
}

export async function getUpcomingAppointments(limit = 10) {
  const res = await api.get<any[]>(`/api/dashboard/upcoming-appointments?limit=${limit}`)
  return res.data || []
}

export async function getRecentReports(limit = 7) {
  const res = await api.get<any[]>(`/api/dashboard/recent-reports?limit=${limit}`)
  return res.data || []
}

export async function getLowStockItems(limit = 10) {
  const res = await api.get<any[]>(`/api/dashboard/low-stock?limit=${limit}`)
  return res.data || []
}

export async function getRecentMedicalRecords(limit = 10) {
  const res = await api.get<any[]>(`/api/dashboard/recent-medical-records?limit=${limit}`)
  return res.data || []
}

export async function getBirthdaysAndFollowups() {
  const res = await api.get<any>('/api/dashboard/alerts')
  return res.data
}
