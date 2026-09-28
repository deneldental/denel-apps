import { api } from '@/lib/api-client'
import type { staff, staffDocuments } from '@/lib/db/schema'

export async function getStaff() {
  const res = await api.get<any[]>('/api/staff')
  return { success: res.success, data: res.data || [], error: res.error }
}

export async function getStaffMember(id: string) {
  const res = await api.get<any>(`/api/staff/${id}`)
  return { success: res.success, data: res.data, error: res.error }
}

export async function createStaff(data: typeof staff.$inferInsert) {
  const res = await api.post<any>('/api/staff', data)
  return res
}

export async function updateStaff(id: string, data: Partial<typeof staff.$inferInsert>) {
  const res = await api.patch<any>(`/api/staff/${id}`, data)
  return res
}

export async function deleteStaff(id: string) {
  const res = await api.delete<any>(`/api/staff/${id}`)
  return res
}

export async function getStaffDocuments(staffId: string) {
  const res = await api.get<any[]>(`/api/staff/${staffId}/documents`)
  return res.data || []
}

export async function addStaffDocument(data: typeof staffDocuments.$inferInsert) {
  const res = await api.post<any>('/api/staff/documents', data)
  return res
}

export async function updateStaffDocument(
  id: string,
  data: Partial<typeof staffDocuments.$inferInsert>
) {
  const res = await api.patch<any>(`/api/staff/documents/${id}`, data)
  return res
}

export async function deleteStaffDocument(id: string) {
  const res = await api.delete<any>(`/api/staff/documents/${id}`)
  return res
}
