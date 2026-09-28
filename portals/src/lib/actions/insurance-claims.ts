import { api } from '@/lib/api-client'

export interface InsuranceClaim {
  id: string
  companyId: string
  companyName: string | null
  patientId: string
  patientName: string | null
  claimNumber: string | null
  chargedAmount: number
  approvedAmount: number | null
  paidAmount: number | null
  status: 'pending' | 'submitted' | 'approved' | 'denied' | 'paid'
  denialReason: string | null
  submittedAt: string | null
  approvedAt: string | null
  paidAt: string | null
  notes: string | null
  createdAt: string
}

export async function getInsuranceClaims(params?: { companyId?: string; status?: string }) {
  const q = new URLSearchParams()
  if (params?.companyId) q.set('companyId', params.companyId)
  if (params?.status) q.set('status', params.status)
  return api.get<InsuranceClaim[]>(`/api/insurance/claims?${q.toString()}`)
}

export interface InsuranceClaimLineInput {
  serviceId?: string | null
  treatmentTypeId?: string | null
  description: string
  /** The clinic's own price for this treatment. */
  clinicPrice: number
  /** The insurer's price. Ignored when `covered` is false. */
  insurerPrice: number
  /** False when the treatment isn't in the insurer's effective price list. */
  covered: boolean
}

export interface InsuranceClaimLine extends InsuranceClaimLineInput {
  id: string
  claimId: string
  lineNumber: number
  createdAt: string
}

/**
 * Creates a claim. When `lines` are supplied the server recomputes
 * `chargedAmount` from the covered lines and ignores any client-sent total —
 * so callers with a breakdown can omit it.
 */
export async function createInsuranceClaim(data: {
  companyId: string
  patientId: string
  chargedAmount?: number
  notes?: string
  lines?: InsuranceClaimLineInput[]
}) {
  return api.post<InsuranceClaim & { lineCount: number }>('/api/insurance/claims', data)
}

export async function getClaimLines(claimId: string) {
  return api.get<InsuranceClaimLine[]>(`/api/insurance/claims/${claimId}/lines`)
}

export async function submitClaim(id: string) {
  return api.patch<InsuranceClaim>(`/api/insurance/claims/${id}/submit`, {})
}

export async function approveClaim(id: string, approvedAmount?: number) {
  return api.patch<InsuranceClaim>(`/api/insurance/claims/${id}/approve`, { approvedAmount })
}

export async function denyClaim(id: string, reason?: string) {
  return api.patch<InsuranceClaim>(`/api/insurance/claims/${id}/deny`, { reason })
}

export async function payClaim(id: string, paidAmount?: number) {
  return api.patch<InsuranceClaim>(`/api/insurance/claims/${id}/pay`, { paidAmount })
}

export async function deleteClaim(id: string) {
  return api.delete(`/api/insurance/claims/${id}`)
}
