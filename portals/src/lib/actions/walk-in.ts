import { api } from '@/lib/api-client'

/**
 * POST /api/walk-in — record a walk-in encounter (appointment + catalog-priced
 * invoice + optional payment) in one atomic backend transaction. Mirrors the
 * mutation convention in the other action wrappers: returns the raw
 * `ApiResponse` so the caller can `surfaceApiError` on failure.
 */
export type WalkInRequest = {
  patientId: string
  appointment: {
    doctorId: string
    chairId?: string | null
    type?: string | null
    notes?: string | null
  }
  lines: Array<{
    serviceId: string
    quantity?: number
    specialistId?: string | null
    discount?: { type: 'percent' | 'amount'; value: number; reason?: string | null } | null
  }>
  payment?: { method: string; amount: number | string; externalReference?: string | null } | null
}

export async function createWalkIn(data: WalkInRequest) {
  return api.post<{
    appointment: { id: string; [k: string]: unknown }
    invoice: { id: string; total: number; balance: number; status: string; [k: string]: unknown }
    payment: { id: string; amount: number; [k: string]: unknown } | null
  }>('/api/walk-in', data)
}
