import { api } from '@/lib/api-client'

export type SyncEntity =
  | 'patients'
  | 'appointments'
  | 'payments'
  | 'expenses'
  | 'lab_cases'
  | 'inventory'
  | 'users'

export interface SyncRule {
  entity: string
  enabled: boolean
  filterCustom: string | null
  filterOptions: Record<string, boolean> | null
  lastSyncedAt: string | null
  recordsSynced: number
  createdAt: string
  updatedAt: string
}

export function getSyncRules() {
  return api.get<SyncRule[]>('/api/sync/rules')
}

export function updateSyncRule(
  entity: string,
  data: Partial<{
    enabled: boolean
    filterCustom: string | null
    filterOptions: Record<string, boolean> | null
  }>
) {
  return api.patch<SyncRule>(`/api/sync/rules/${entity}`, data)
}
