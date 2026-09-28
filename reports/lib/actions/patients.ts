import { api } from '@/lib/api-client'
import type { patients } from '@/lib/db/schema'

export async function getPatients() {
  const res = await api.get<any[]>('/api/patients')
  return { success: res.success, data: res.data || [], error: res.error }
}

export async function getPatient(id: string) {
  const res = await api.get<any>(`/api/patients/${id}`)
  return { success: res.success, data: res.data, error: res.error }
}

export async function createPatient(data: typeof patients.$inferInsert) {
  const res = await api.post<any>('/api/patients', data)
  return res
}

export async function updatePatient(id: string, data: Partial<typeof patients.$inferInsert>) {
  const res = await api.patch<any>(`/api/patients/${id}`, data)
  return res
}

export async function deletePatient(id: string) {
  const res = await api.delete<any>(`/api/patients/${id}`)
  return res
}

export async function importPatientsFromCSV(csvData: Array<Record<string, string>>) {
  const res = await api.post<any>('/api/patients/import', csvData)
  return res
}
