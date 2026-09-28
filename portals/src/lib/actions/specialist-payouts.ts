import { api } from '@/lib/api-client'

export type CommissionStatus = 'accrued' | 'payable' | 'paid' | 'reversed'
export type PayoutStatus = 'draft' | 'posted' | 'paid'

export type Commission = {
  id: string
  specialistId: string
  invoiceId: string
  invoiceLineId: string
  grossAmount: number
  commissionRate: number
  commissionAmount: number
  payableAmount: number
  status: CommissionStatus
  accruedAt: string
  becamePayableAt: string | null
  paidAt: string | null
  payoutId: string | null
  invoice?: { id: string; invoiceNumber: string; total: number; balance: number }
}

export type Payout = {
  id: string
  payoutNumber: string
  specialistId: string
  periodStart: string
  periodEnd: string
  grossAmount: number
  withholdingTaxAmount: number
  netAmount: number
  status: PayoutStatus
  paymentId: string | null
  journalEntryId: string | null
  postedAt: string | null
  paidAt: string | null
  createdAt: string
  specialist?: { id: string; name: string }
}

export type SpecialistBalance = {
  specialistId: string
  accruedAmount: number
  payableAmount: number
  paidAmount: number
}

export async function listPayouts(opts?: { status?: PayoutStatus; specialistId?: string }) {
  const params = new URLSearchParams()
  if (opts?.status) params.set('status', opts.status)
  if (opts?.specialistId) params.set('specialistId', opts.specialistId)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await api.get<Payout[]>(`/api/specialist-payouts${qs}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function getPayout(id: string) {
  return api.get<Payout & { commissions: Commission[] }>(`/api/specialist-payouts/${id}`)
}

export async function createPayout(input: {
  specialistId: string
  periodStart: string
  periodEnd: string
}) {
  return api.post<Payout>('/api/specialist-payouts', input)
}

export async function postPayout(
  id: string,
  input: {
    method: 'cash' | 'bank_transfer' | 'momo' | 'card' | 'cheque'
    paymentDate?: string
    externalReference?: string | null
  }
) {
  return api.post<{ payout: Payout; journalEntry: { id: string; entryNumber: string } }>(
    `/api/specialist-payouts/${id}/post`,
    input
  )
}

export async function listSpecialistCommissions(
  specialistId: string,
  opts?: { status?: CommissionStatus; from?: string; to?: string }
) {
  const params = new URLSearchParams()
  if (opts?.status) params.set('status', opts.status)
  if (opts?.from) params.set('from', opts.from)
  if (opts?.to) params.set('to', opts.to)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await api.get<Commission[]>(
    `/api/specialist-payouts/specialist/${specialistId}/commissions${qs}`
  )
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function getSpecialistBalance(specialistId: string) {
  return api.get<SpecialistBalance>(`/api/specialist-payouts/specialist/${specialistId}/balance`)
}
