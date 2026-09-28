import { api } from '@/lib/api-client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ServiceProvider {
  id: string
  name: string
  contact: string | null
  isActive: boolean
}

export interface PettyCashStaffRow {
  id: string // petty_cash_staff.id
  staffId: string // staff.id
  staffCode: string | null // human staff code (FDM-S0001)
  fullName: string
  phone: string | null
  position: string | null
}

export interface AvailableStaff {
  id: string // staff.id
  staffCode: string | null
  fullName: string
  position: string | null
}

export type PettyRefType = 'none' | 'service_provider' | 'staff'
export type PettyConfirmationStatus = 'pending' | 'confirmed' | 'flagged'

export interface PettyTransaction {
  id: string
  date: string
  category: string
  categoryDisplay: string | null
  pettyRefType: PettyRefType | null
  amount: number
  paidTo: string | null
  pettyRefName: string | null
  pettyRefContact: string | null
  attachmentUrl: string | null
  paymentMethod: string | null
  description: string | null
  confirmationStatus: PettyConfirmationStatus | null
  confirmationNote: string | null
  confirmationProofUrl: string | null
  confirmedAt: string | null
  submittedBy: string | null
  confirmedBy: string | null
}

export interface PettyTotals {
  count: number
  amount: number
  byStatus: Record<string, number>
}

export interface PettyCategory {
  id: string
  name: string
  displayName: string | null
  isActive?: boolean
  isPettyCash?: boolean
  pettyRefType?: PettyRefType
}

// ── Service providers ──────────────────────────────────────────────────────────

export const getServiceProviders = () => api.get<ServiceProvider[]>('/api/petty-cash/providers')
export const createServiceProvider = (data: { name: string; contact?: string }) =>
  api.post<ServiceProvider>('/api/petty-cash/providers', data)
export const updateServiceProvider = (
  id: string,
  data: { name?: string; contact?: string; isActive?: boolean }
) => api.patch<ServiceProvider>(`/api/petty-cash/providers/${id}`, data)
export const deleteServiceProvider = (id: string) => api.delete(`/api/petty-cash/providers/${id}`)

// ── Curated errand staff ─────────────────────────────────────────────────────

export const getPettyCashStaff = () => api.get<PettyCashStaffRow[]>('/api/petty-cash/staff')
export const getAvailableStaff = () => api.get<AvailableStaff[]>('/api/petty-cash/staff/available')
export const addPettyCashStaff = (staffId: string) => api.post('/api/petty-cash/staff', { staffId })
export const removePettyCashStaff = (id: string) => api.delete(`/api/petty-cash/staff/${id}`)

// ── Transactions + confirm/flag ──────────────────────────────────────────────

export function getPettyTransactions(params?: { from?: string; to?: string; status?: string }) {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  if (params?.status) q.set('status', params.status)
  return api.get<{ transactions: PettyTransaction[]; totals: PettyTotals }>(
    `/api/petty-cash/transactions?${q.toString()}`
  )
}
export const confirmPettyTransaction = (id: string, data: { note?: string; proofUrl?: string }) =>
  api.patch(`/api/petty-cash/transactions/${id}/confirm`, data)
export const flagPettyTransaction = (id: string, reason?: string) =>
  api.patch(`/api/petty-cash/transactions/${id}/flag`, { reason })

// ── Category petty config ────────────────────────────────────────────────────

export const setCategoryPetty = (
  categoryId: string,
  data: { isPettyCash: boolean; pettyRefType: PettyRefType }
) => api.patch(`/api/expenses/categories/${categoryId}/petty`, data)

// ── Box balance + replenishments (settings-domain-audit S5-B) ─────────────────
export interface PettyBalance {
  source: 'replenishment' | 'default'
  /** Pesewas. */
  floatAmount: number
  since: string
  spentSince: number
  balance: number
  warningThreshold: number
  belowWarning: boolean
  approvalLimit: number
  maxActiveIousPerStaff: number
  lastReplenishment: { id: string; date: string; amount: number; note: string | null } | null
}

export interface PettyReplenishment {
  id: string
  date: string
  amount: number
  note: string | null
  recordedBy: string | null
  createdAt: string
}

export const getPettyBalance = () => api.get<PettyBalance>('/api/petty-cash/balance')
export const getPettyReplenishments = () =>
  api.get<PettyReplenishment[]>('/api/petty-cash/replenishments')
/** `amount` in pesewas. */
export const recordPettyReplenishment = (data: { amount: number; date?: string; note?: string }) =>
  api.post<PettyReplenishment>('/api/petty-cash/replenishments', data)
