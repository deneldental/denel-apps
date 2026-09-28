import { api } from '@/lib/api-client'

export type CampaignStatus = 'pending' | 'sent' | 'dismissed'

export interface CampaignEntry {
  id: string
  patientId: string
  patientName: string
  phone: string
  context: string
  dueAt: string | null
  status: CampaignStatus
}

export interface AdTemplate {
  id: string
  name: string
  body: string
  createdAt: string
  updatedAt: string
}

export function getCrmFollowUps() {
  return api.get<CampaignEntry[]>('/api/crm/follow-ups')
}

export function getCrmRecareDue() {
  return api.get<CampaignEntry[]>('/api/crm/recare-due')
}

export function getCrmBirthdays() {
  return api.get<CampaignEntry[]>('/api/crm/birthdays')
}

// ── §13.4 Audience builder ──────────────────────────────────────────────────

/** Fixed campaign segments accepted by POST /api/crm/audience. */
export type AudienceSegment = 'follow_up' | 'recare' | 'birthday' | 'all'

export interface AudienceFilters {
  treatmentTypeId?: string | null
  tagIds?: string[]
  segment?: AudienceSegment
}

export interface AudienceRecipient {
  patientId: string
  patientName: string
  phone: string
}

export interface AudienceResult {
  recipients: AudienceRecipient[]
  count: number
}

/**
 * Resolve audience filters (fixed segment AND/OR treatment-type + tags) to a
 * recipient list + count. Opt-out patients are always excluded server-side.
 */
export function resolveAudience(filters: AudienceFilters) {
  return api.post<AudienceResult>('/api/crm/audience', filters)
}

export function getAdTemplates() {
  return api.get<AdTemplate[]>('/api/crm/ad-templates')
}

export function createAdTemplate(data: { name: string; body: string }) {
  return api.post<AdTemplate>('/api/crm/ad-templates', data)
}

export function updateAdTemplate(id: string, data: Partial<{ name: string; body: string }>) {
  return api.patch<AdTemplate>(`/api/crm/ad-templates/${id}`, data)
}

export function deleteAdTemplate(id: string) {
  return api.delete<void>(`/api/crm/ad-templates/${id}`)
}
