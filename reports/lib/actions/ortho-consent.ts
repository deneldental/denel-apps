import { api } from '@/lib/api-client'

/**
 * Get all ortho consent forms
 */
export async function getOrthoConsentForms(searchTerm?: string) {
  return api.get<any[]>(`/api/ortho-consent${searchTerm ? `?searchTerm=${searchTerm}` : ''}`)
}

/**
 * Upload consent form for a patient
 */
export async function uploadConsentForm(data: {
  patientId: string
  consentFormUrl: string
  notes?: string
}) {
  const res = await api.post<any>('/api/ortho-consent', data)
  return res
}

/**
 * Delete consent form
 */
export async function deleteConsentForm(patientId: string) {
  const res = await api.patch<any>(`/api/ortho-consent/${patientId}/delete`, {})
  return res
}
