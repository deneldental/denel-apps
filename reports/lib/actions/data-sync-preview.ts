import { api } from '@/lib/api-client'

export interface MedicalRecordWithCounts {
  id: string
  patientId: string
  date: string
  createdAt: string
  patientName: string
  treatmentName: string
  totalCount: number
  syncedCount: number
}

export interface DataToSyncItem {
  type: string
  count: number
  items: any[]
}

export interface SyncPreviewData {
  records: MedicalRecordWithCounts[]
  totals: {
    total: number
    synced: number
    pending: number
  }
  dataToSync: DataToSyncItem[]
}

export async function getMedicalRecordsForSync() {
  const res = await api.get<MedicalRecordWithCounts[]>('/api/sync-preview/medical-records')
  return res.data || []
}

export async function getSyncPreview(
  recordId: string,
  syncOptions: any
): Promise<SyncPreviewData | undefined> {
  const query = new URLSearchParams(syncOptions).toString()
  const res = await api.get<SyncPreviewData>(`/api/sync-preview/${recordId}?${query}`)
  return res.data
}
