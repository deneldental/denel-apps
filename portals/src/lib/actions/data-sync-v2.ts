import { api } from '@/lib/api-client'

export interface SyncResult {
  success: boolean
  message: string
  details?: {
    totalRecords: number
    syncedRecords: number
    failed: number
    errors?: string[]
  }
}

const SYNC_CONFIG_KEY = 'syncConfig'

export async function getSyncConfig(): Promise<{ destinationUrl?: string; isLocked?: boolean }> {
  try {
    const stored = localStorage.getItem(SYNC_CONFIG_KEY)
    if (stored) return JSON.parse(stored)
  } catch {
    // ignore parse errors
  }
  return {}
}

export async function performManualSync(
  connectionString: string,
  patientIds: string[]
): Promise<SyncResult> {
  let totalSynced = 0
  let totalFailed = 0
  const errors: string[] = []

  for (const patientId of patientIds) {
    const res = await api.post<any>('/api/sync/patients', {
      connectionString,
      types: [],
      singlePatientId: patientId,
    })
    if (res.success && res.data) {
      totalSynced += res.data.details?.synced ?? 1
      totalFailed += res.data.details?.failed ?? 0
      if (res.data.details?.errors?.length) {
        errors.push(...res.data.details.errors)
      }
    } else {
      totalFailed++
      if (res.error) errors.push(`Patient ${patientId}: ${res.error}`)
    }
  }

  const total = patientIds.length
  return {
    success: totalFailed === 0,
    message: `Synced ${totalSynced} of ${total} patient(s)${
      totalFailed > 0 ? `, ${totalFailed} failed` : ''
    }`,
    details: {
      totalRecords: total,
      syncedRecords: totalSynced,
      failed: totalFailed,
      errors,
    },
  }
}

export async function getAutoSyncTreatmentTypes() {
  return api.get<any[]>('/api/sync/treatment-types')
}

export async function updateTreatmentAutoSync(treatmentTypeId: string, enabled: boolean) {
  return api.patch<any>(`/api/sync/treatment-types/${treatmentTypeId}`, { enabled })
}

export async function getSyncHistory(limit = 50) {
  return api.get<any[]>(`/api/sync/history?limit=${limit}`)
}
