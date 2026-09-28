import { api } from '@/lib/api-client'
import type { medicalRecords } from '@/lib/db/schema'

export async function getMedicalRecords() {
  const res = await api.get<any[]>('/api/medical-records')
  return { success: res.success, data: res.data || [], error: res.error }
}

export async function getMedicalRecord(id: string) {
  const res = await api.get<any>(`/api/medical-records/${id}`)
  return { success: res.success, data: res.data, error: res.error }
}

export async function getMedicalRecordsByPatientId(patientId: string) {
  const res = await api.get<any[]>(`/api/medical-records/patient/${patientId}`)
  return { success: res.success, data: res.data || [], error: res.error }
}

export async function createMedicalRecord(data: typeof medicalRecords.$inferInsert) {
  const res = await api.post<any>('/api/medical-records', data)
  return res
}

export async function updateMedicalRecord(
  id: string,
  data: Partial<typeof medicalRecords.$inferInsert>
) {
  const res = await api.patch<any>(`/api/medical-records/${id}`, data)
  return res
}

export async function deleteMedicalRecord(id: string) {
  const res = await api.delete<any>(`/api/medical-records/${id}`)
  return res
}

// Pending Medical Records Actions
export async function createPendingMedicalRecord(data: {
  patientId: string
  doctorId: string
  appointmentId: string
}) {
  const res = await api.post<any>('/api/medical-records/pending', data)
  return res
}

export async function getPendingMedicalRecords(doctorId?: string) {
  const url = doctorId
    ? `/api/medical-records/pending?doctorId=${doctorId}`
    : '/api/medical-records/pending'
  const res = await api.get<any[]>(url)
  return res.data || []
}

export async function completePendingMedicalRecord(id: string) {
  const res = await api.post<any>(`/api/medical-records/pending/${id}/complete`, {})
  return res
}
