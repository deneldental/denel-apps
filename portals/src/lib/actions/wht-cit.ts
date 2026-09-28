import { api } from '@/lib/api-client'

export type WhtCertificate = {
  id: string
  partyType: 'specialist' | 'supplier'
  partyId: string
  taxYear: number
  taxMonth?: number | null
  certificateRef?: string | null
  grossAmount: number
  whtRate: number
  whtAmount: number
  journalEntryId?: string | null
  issuedAt?: string | null
  remittedAt?: string | null
  notes?: string | null
  createdById?: string | null
  createdAt: string
}

export type CitInstallment = {
  id: string
  taxYear: number
  quarter: number
  dueDate: string
  estimatedAmount?: number | null
  paidAmount?: number | null
  paidAt?: string | null
  journalEntryId?: string | null
  notes?: string | null
  createdById?: string | null
  createdAt: string
}

export async function listWhtCertificates(params?: {
  taxYear?: number
  partyType?: 'specialist' | 'supplier'
}) {
  const qs = new URLSearchParams()
  if (params?.taxYear) qs.set('taxYear', String(params.taxYear))
  if (params?.partyType) qs.set('partyType', params.partyType)
  const suffix = qs.toString() ? `?${qs}` : ''
  const res = await api.get<WhtCertificate[]>(`/api/wht-certificates${suffix}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function createWhtCertificate(data: {
  partyType: 'specialist' | 'supplier'
  partyId: string
  taxYear: number
  taxMonth?: number
  certificateRef?: string
  grossAmount: number
  whtRate: number
  whtAmount: number
  issuedAt?: string
  notes?: string
}) {
  return api.post<WhtCertificate>('/api/wht-certificates', data)
}

export async function remitWhtCertificate(id: string) {
  return api.post<WhtCertificate>(`/api/wht-certificates/${id}/remit`, {})
}

export async function listCitInstallments(params?: { taxYear?: number }) {
  const qs = new URLSearchParams()
  if (params?.taxYear) qs.set('taxYear', String(params.taxYear))
  const suffix = qs.toString() ? `?${qs}` : ''
  const res = await api.get<CitInstallment[]>(`/api/cit-installments${suffix}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function upsertCitInstallment(data: {
  taxYear: number
  quarter: number
  dueDate: string
  estimatedAmount?: number
  notes?: string
}) {
  return api.post<CitInstallment>('/api/cit-installments', data)
}

export async function payCitInstallment(id: string, data: { paidAmount: number; paidAt?: string }) {
  return api.patch<CitInstallment>(`/api/cit-installments/${id}/pay`, data)
}

// ── Tax Obligations (§4.5) ────────────────────────────────────────────────────

export type CitObligationEntry = {
  id: string
  quarter: number
  dueDate: string
  estimatedAmount: number | null
  paidAmount: number | null
  paidAt: string | null
  status: 'paid' | 'overdue' | 'due' | 'upcoming'
}

export type TaxObligations = {
  year: number
  month: number
  payroll: {
    id: string
    name: string
    paye: number
    ssnitEmployee: number
    ssnitEmployer: number
    ssnitTotal: number
    totalGross: number
    staffCount: number
    status: string
  } | null
  whtYtd: {
    count: number
    totalAmount: number
    remittedAmount: number
    remittedCount: number
    outstandingAmount: number
  }
  cit: CitObligationEntry[]
}

export async function getTaxObligations(params: { year: number; month: number }) {
  const qs = new URLSearchParams({ year: String(params.year), month: String(params.month) })
  return api.get<TaxObligations>(`/api/payroll/tax-obligations?${qs}`)
}
