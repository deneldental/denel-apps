import { api } from '@/lib/api-client'

export async function getAutoSyncTreatmentTypes() {
  return api.get<any[]>('/api/sync/treatment-types')
}

export async function updateTreatmentAutoSync(treatmentTypeId: string, enabled: boolean) {
  return api.patch<any>(`/api/sync/treatment-types/${treatmentTypeId}`, { enabled })
}

export async function getSyncHistory(limit = 50) {
  return api.get<any[]>(`/api/sync/history?limit=${limit}`)
}

// Medical records sync refactored into backend as well
export async function syncMedicalRecordsAndPayments(
  connectionString: string,
  mode: string,
  options: any
) {
  return api.post<any>('/api/sync/medical-records-payments', { connectionString, mode, ...options })
}
