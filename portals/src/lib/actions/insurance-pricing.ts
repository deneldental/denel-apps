import { API_BASE_URL, api } from '@/lib/api-client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface InsurerPriceList {
  id: string
  companyId: string
  fileName: string
  status: 'draft' | 'effective' | 'archived'
  rowCount: number
  approved: number
  pending: number
  uploadedAt: string
  effectiveAt: string | null
}

export interface InsurerPriceListItem {
  id: string
  serviceId: string | null
  ourServiceName: string | null
  insurerName: string
  insurerCode: string | null
  ourName: string | null
  price: number
  mappingStatus: 'approved' | 'pending_approval' | 'rejected'
  rejectionReason: string | null
  rowIndex: number
}

export interface InsuranceApprovalItem {
  id: string
  companyId: string
  companyName: string | null
  priceListId: string
  insurerName: string
  insurerCode: string | null
  ourName: string | null
  price: number
  createdAt: string
}

// ── Actions ──────────────────────────────────────────────────────────────────

/** Download the insurer pricing CSV template (our services, prefilled). */
export async function downloadInsurerTemplate(
  companyId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/insurance/companies/${companyId}/price-template`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'X-App-Id': 'portal' },
    })
    if (!res.ok) return { success: false, error: `Template download failed (${res.status})` }
    const text = await res.text()
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `insurer-pricing-${companyId}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Download failed' }
  }
}

export async function uploadInsurerPriceList(companyId: string, fileName: string, csv: string) {
  return api.post<{
    id: string
    rowCount: number
    approved: number
    pending: number
    errors: string[]
  }>(`/api/insurance/companies/${companyId}/price-lists`, { fileName, csv })
}

export async function getInsurerPriceLists(companyId: string) {
  return api.get<InsurerPriceList[]>(`/api/insurance/companies/${companyId}/price-lists`)
}

export async function getInsurerPriceList(id: string) {
  return api.get<InsurerPriceList & { items: InsurerPriceListItem[] }>(
    `/api/insurance/price-lists/${id}`
  )
}

export async function setInsurerPriceListEffective(id: string) {
  return api.post<{ id: string; status: string }>(
    `/api/insurance/price-lists/${id}/set-effective`,
    {}
  )
}

export async function deleteInsurerPriceList(id: string) {
  return api.delete(`/api/insurance/price-lists/${id}`)
}

export async function getInsuranceApprovals(companyId?: string) {
  const q = companyId ? `?companyId=${companyId}` : ''
  return api.get<InsuranceApprovalItem[]>(`/api/insurance/approvals${q}`)
}

export async function approveInsurerItem(itemId: string, serviceId: string) {
  return api.patch(`/api/insurance/price-list-items/${itemId}/approve`, { serviceId })
}

export async function rejectInsurerItem(itemId: string, reason?: string) {
  return api.patch(`/api/insurance/price-list-items/${itemId}/reject`, { reason })
}

// ── Manual price grid ────────────────────────────────────────────────────────
// Writes the same tables the CSV flow writes; use it for one-off edits.

export interface InsurerServicePrice {
  serviceId: string
  name: string
  category: string
  treatmentTypeId: string | null
  /** What the clinic charges a self-pay patient. */
  clinicPrice: number
  /** What this insurer pays. `null` = not covered. */
  insurerPrice: number | null
}

export async function getInsurerServicePrices(companyId: string) {
  return api.get<{ hasEffectiveList: boolean; services: InsurerServicePrice[] }>(
    `/api/insurance/companies/${companyId}/prices`
  )
}

/** Replaces the insurer's live price list. Omitted services become uncovered. */
export async function saveInsurerServicePrices(
  companyId: string,
  prices: Array<{ serviceId: string; price: number }>
) {
  return api.put<{ count: number }>(`/api/insurance/companies/${companyId}/prices`, { prices })
}
