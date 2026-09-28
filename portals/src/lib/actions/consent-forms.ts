import { api } from '@/lib/api-client'

// ── Pending consents (admin-v1 §18.2) ──────────────────────────────────────
// Required consent forms a patient has NOT yet signed before a procedure.
// Mirrors the backend `pending-consents-service` shape.

export interface PendingConsentTemplate {
  templateId: string
  templateName: string
  category: string | null
  requiresWitness: boolean
}

export interface PendingConsentPatient {
  patientId: string
  patientName: string
  /** Earliest upcoming appointment date (ISO string), if scoped that way. */
  nextAppointmentDate: string | null
  pending: PendingConsentTemplate[]
}

export interface PendingConsentsResponse {
  success: boolean
  data?: PendingConsentPatient[]
  /** Total outstanding (patient × required-template) pairs across the scope. */
  totalPending?: number
  error?: string
}

export interface GetPendingConsentsParams {
  /** Scope to a single patient (e.g. a pre-procedure chart check). */
  patientId?: string
  /**
   * When false, include every patient (heavy "all outstanding" reporting).
   * Defaults to true on the backend → only patients with an upcoming appointment.
   */
  upcomingOnly?: boolean
}

/**
 * GET /api/consent-forms/pending — patients with outstanding required consents.
 * The response carries an extra top-level `totalPending` count alongside `data`.
 */
export async function getPendingConsents(
  params: GetPendingConsentsParams = {}
): Promise<PendingConsentsResponse> {
  const search = new URLSearchParams()
  if (params.patientId) search.set('patientId', params.patientId)
  if (params.upcomingOnly === false) search.set('upcomingOnly', 'false')
  const qs = search.toString()
  return api.get<PendingConsentPatient[]>(
    `/api/consent-forms/pending${qs ? `?${qs}` : ''}`
  ) as Promise<PendingConsentsResponse>
}
