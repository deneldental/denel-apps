import { api } from '@/lib/api-client'

export type SpecialistType = 'internal' | 'external'

export type Specialist = {
  id: string
  name: string
  /** Free-text specialisation label, e.g. "Orthodontist". PR-16. */
  specialty: string | null
  /** Avatar URL on DO Spaces. PR-16. */
  profileImage: string | null
  contactEmail: string | null
  contactPhone: string | null
  tin: string | null
  specialistType: SpecialistType
  userId: string | null
  defaultCommissionRate: number
  withholdingTaxRate: number
  payoutMethod: string | null
  payoutAccountDetails: Record<string, unknown> | null
  /**
   * Google Calendar this doctor's appointments sync to. Null means the service
   * account auto-provisions one, or events fall back to the shared clinic
   * calendar. Set from the Calendar link tab on the specialist page.
   */
  gcalCalendarId: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/** Redacted picker row from /api/specialists/directory — no payout intel. */
export type SpecialistDirectoryEntry = Pick<
  Specialist,
  | 'id'
  | 'name'
  | 'specialty'
  | 'profileImage'
  | 'specialistType'
  | 'defaultCommissionRate'
  | 'isActive'
>

export async function listSpecialists(opts?: { includeInactive?: boolean }) {
  const qs = opts?.includeInactive ? '?includeInactive=true' : ''
  const res = await api.get<Specialist[]>(`/api/specialists${qs}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

/**
 * Active specialists for doctor-assignment dropdowns. Unlike `listSpecialists`
 * this only needs `payments:read`, so receptionists and doctors can attribute a
 * treatment line without holding the finance-scoped `specialists:read` grant.
 */
export async function listSpecialistDirectory() {
  const res = await api.get<SpecialistDirectoryEntry[]>('/api/specialists/directory')
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function getSpecialist(id: string) {
  return api.get<Specialist>(`/api/specialists/${id}`)
}

export async function createSpecialist(input: {
  name: string
  specialty?: string | null
  profileImage?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  tin?: string | null
  specialistType?: SpecialistType
  userId?: string | null
  defaultCommissionRate?: number
  withholdingTaxRate?: number
  payoutMethod?: string | null
  payoutAccountDetails?: Record<string, unknown> | null
  /** When set on an internal specialist, the backend mints a user account,
   *  hashes the password, grants portal scope, assigns the `doctor` role, and
   *  links userId onto the new specialist row — all in one request.
   *
   *  No `pwaAccess`: doctors hold portal scope only and do no work from the
   *  Team app, so the backend no longer writes a pwa scope row at all. */
  password?: string
  portalAccess?: boolean
}) {
  return api.post<Specialist>('/api/specialists', input)
}

/** Active specialty options for the create form (lookup table). */
export async function listSpecialtyOptions() {
  return api.get<Array<{ id: string; name: string; displayName?: string | null }>>(
    '/api/lookups/specialties'
  )
}

export async function updateSpecialist(id: string, input: Partial<Specialist>) {
  return api.patch<Specialist>(`/api/specialists/${id}`, input)
}

export async function deactivateSpecialist(id: string) {
  return api.delete<Specialist>(`/api/specialists/${id}`)
}
