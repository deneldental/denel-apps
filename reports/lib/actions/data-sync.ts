import { api } from '@/lib/api-client'

export interface SyncResult {
  success: boolean
  message: string
  synced?: number
  failed?: number
  errors?: string[]
}

export async function syncPatients(
  connectionString: string,
  types: string[],
  singlePatientId?: string
) {
  const res = await api.post<SyncResult>('/api/sync/patients', {
    connectionString,
    types,
    singlePatientId,
  })
  return res.data
}
