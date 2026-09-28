import { api } from '@/lib/api-client'

export interface LabStageConfig {
  id: string
  name: string
  displayName: string
  sortOrder: number
  color: string | null
  isActive: boolean
  /** Per-status patient SMS template. Null → no notification for this status. */
  smsTemplate: string | null
}

/** Configurable lab-case progress stages (ordered). `?all=1` includes inactive. */
export function getLabCaseStatuses() {
  return api.get<LabStageConfig[]>('/api/labs/case-statuses?all=1')
}

export interface LabStatusHistoryRow {
  id: string
  fromStatus: string | null
  toStatus: string
  createdAt: string
  byName: string | null
  byRole: string | null
}

/** Single lab case (for the dedicated case page). */
export function getLabCase(caseId: string) {
  return api.get<any>(`/api/labs/cases/${caseId}`)
}

/** Update a lab case (status / notes / delay fields). */
export function updateLabCase(caseId: string, data: Record<string, unknown>) {
  return api.patch<any>(`/api/labs/cases/${caseId}`, data)
}

/** Compose (no send) the per-status patient SMS. */
export function labSmsPreview(caseId: string, status: string) {
  return api.get<{
    hasTemplate: boolean
    message: string | null
    hasPhone: boolean
    doNotContact: boolean
  }>(`/api/labs/cases/${caseId}/sms-preview?status=${encodeURIComponent(status)}`)
}

/** Send the per-status patient SMS. */
export function labNotifyPatient(caseId: string, status: string) {
  return api.post<{ message: string }>(`/api/labs/cases/${caseId}/notify-patient`, { status })
}

/** Paginated progress-change history for a case. */
export function getLabStatusHistory(caseId: string, limit = 10, offset = 0) {
  return api.get<LabStatusHistoryRow[]>(
    `/api/labs/cases/${caseId}/status-history?limit=${limit}&offset=${offset}`
  )
}

/**
 * Admin edits a stage's display config + per-status SMS template. The canonical
 * `name` (which billing keys off) is immutable. Send `smsTemplate: ''` to clear.
 */
export function updateLabCaseStatus(
  id: string,
  data: Partial<
    Pick<LabStageConfig, 'displayName' | 'sortOrder' | 'color' | 'isActive' | 'smsTemplate'>
  >
) {
  return api.patch<LabStageConfig>(`/api/labs/case-statuses/${id}`, data)
}
