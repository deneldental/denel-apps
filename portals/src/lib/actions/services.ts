import { API_BASE_URL, type ApiResponse, api } from '@/lib/api-client'

export interface ServicePrice {
  id: string
  name: string
  amount: number
  currency: string
  /** Present only when an insuranceCompanyId was passed alongside a treatment.
   *  false ⇒ the service isn't in the insurer's effective/approved list, so it
   *  can't be billed to that insurer (only self-pay). */
  insurerCovered?: boolean
  /** The clinic's own price. Returned alongside `amount` on insurer lookups,
   *  where `amount` holds the insurer's rate instead — an uncovered treatment
   *  still needs a price to charge the patient. */
  clinicPrice?: number
}

export async function lookupServicePrice(params: {
  serviceId?: string
  treatmentTypeId?: string
  xrayTypeId?: string
  labServiceId?: string
  insuranceCompanyId?: string
}): Promise<{ success: boolean; data?: ServicePrice | null }> {
  const query = new URLSearchParams()
  if (params.serviceId) query.set('serviceId', params.serviceId)
  if (params.treatmentTypeId) query.set('treatmentTypeId', params.treatmentTypeId)
  if (params.xrayTypeId) query.set('xrayTypeId', params.xrayTypeId)
  if (params.labServiceId) query.set('labServiceId', params.labServiceId)
  if (params.insuranceCompanyId) query.set('insuranceCompanyId', params.insuranceCompanyId)
  return api.get<ServicePrice | null>(`/api/services/lookup?${query.toString()}`)
}

/** `GET /api/services` list response. `data` is still a bare array; `count` is
 *  the total number of matching rows and `truncated` says the server cut the
 *  list at its cap, so the UI can warn instead of silently hiding rows. */
export type ServicesListResponse = ApiResponse<any[]> & {
  count?: number
  truncated?: boolean
}

export async function getServices(params?: {
  category?: string
  /** Include retired (soft-deleted) rows. Off by default. */
  includeDeleted?: boolean
  /** Approval state ('pending' | 'active' | 'rejected') — NOT "sellable now".
   *  For a picker of services that can be sold today, use `activeOnly`. */
  status?: string
  /** Sellable right now: isActive === true AND status === 'active'. */
  activeOnly?: boolean | string
}): Promise<ServicesListResponse> {
  const query = new URLSearchParams()
  if (params?.category) query.set('category', params.category)
  if (params?.status) query.set('status', params.status)
  if (params?.activeOnly) query.set('activeOnly', String(params.activeOnly))
  if (params?.includeDeleted) query.set('includeDeleted', '1')
  return api.get<any[]>(`/api/services?${query.toString()}`) as Promise<ServicesListResponse>
}

export async function getPendingServices() {
  return api.get<any[]>('/api/services/pending')
}

export async function createService(data: {
  category: string
  name: string
  amount: number
  currency?: string
  isActive?: boolean
  discountEligible?: boolean
  taxStatus?: 'exempt' | 'standard' | 'zero_rated'
  icd10Code?: string | null
  treatmentTypeId?: string
  xrayTypeId?: string
  labServiceId?: string
  insuranceCompanyId?: string
  cdtCode?: string | null
  durationMinutes?: number | null
  effectiveFrom?: string | null
  costPrice?: number | null
  // Pricing matrix (P1) — internal service code (auto if omitted), scope + range.
  serviceCode?: string | null
  scopeId?: string | null
  priceMin?: number | null
  priceMax?: number | null
  // Pricing refinements (R1) — stacked taxes + variants/price-range flags.
  taxIds?: string[]
  variantsEnabled?: boolean
  priceRangeEnabled?: boolean
}) {
  return api.post<any>('/api/services', data)
}

/** `PATCH /api/services/:id` response. Admins get the updated service back
 *  (200). A non-admin's edit becomes a change request instead: the backend
 *  answers 202 with `pendingReview: true` and `data` = the request row, so the
 *  UI must key its "submitted for approval" message off that flag, not off the
 *  caller's own role guess. */
export type UpdateServiceResponse = ApiResponse<any> & { pendingReview?: boolean }

export async function updateService(
  id: string,
  data: Record<string, unknown>
): Promise<UpdateServiceResponse> {
  return api.patch<any>(`/api/services/${id}`, data) as Promise<UpdateServiceResponse>
}

// ── Base-catalog CSV (P1) ──────────────────────────────────────────────────────

/** Download the CSV template (current services for a category) as a file. Uses a
 *  raw fetch because the endpoint returns CSV, not JSON (the api-client would
 *  try to JSON-parse it). Sends the same X-App-Id + cookie as the api-client. */
export async function downloadServicesCsv(
  category: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/services/export?category=${encodeURIComponent(category)}`,
      { method: 'GET', credentials: 'include', headers: { 'X-App-Id': 'portal' } }
    )
    if (!res.ok) return { success: false, error: `Export failed (${res.status})` }
    const text = await res.text()
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `services-${category}-template.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Download failed' }
  }
}

export interface ServiceCsvPreview {
  committed: boolean
  /** `amount` / `was` are integer pesewas (cents) — the server has already
   *  multiplied the human-facing cedis in the CSV by 100. Format with
   *  `formatAmount` for display. */
  toUpdate: Array<{ id: string; name: string; amount: number; was: number | null }>
  toCreate: Array<{ name: string; amount: number }>
  errors: string[]
  updated?: number
  created?: number
}

/** Upload CSV for a category. commit=false → preview only; commit=true → apply. */
export async function importServicesCsv(category: string, csv: string, commit: boolean) {
  return api.post<ServiceCsvPreview>('/api/services/import', { category, csv, commit })
}

export async function approveServiceRequest(id: string) {
  return api.patch<any>(`/api/services/requests/${id}/approve`, {})
}

export async function rejectServiceRequest(id: string, reason?: string) {
  return api.patch<any>(`/api/services/requests/${id}/reject`, { reason })
}

// ── Service ↔ Doctor links ────────────────────────────────────────────────────

export interface ServiceDoctorLink {
  doctorId: string
  doctorName: string
  specialistType: 'internal' | 'external'
  /** Per-link commission rate (0–100). Null = fall back to defaultCommissionRate. */
  commissionRate: number | null
  withholdingTaxRate: number | null
  /** Explicit override: this doctor earns zero on this service even if a rate is set. */
  noCommission: boolean
  isActive: boolean
  defaultCommissionRate: number
}

export async function getServiceDoctors(serviceId: string) {
  return api.get<ServiceDoctorLink[]>(`/api/services/${serviceId}/doctors`)
}

export async function setServiceDoctors(
  serviceId: string,
  doctors: Array<{
    doctorId: string
    commissionRate?: number | null
    withholdingTaxRate?: number | null
    noCommission?: boolean
    isActive?: boolean
  }>
) {
  return api.put<{ count: number }>(`/api/services/${serviceId}/doctors`, { doctors })
}

export interface DoctorServiceLink {
  serviceId: string
  serviceName: string
  category: 'clinic' | 'xray' | 'lab' | 'insurance'
  amount: number
  currency: string
  commissionRate: number | null
  withholdingTaxRate: number | null
  noCommission: boolean
  isActive: boolean
}

export async function getSpecialistServices(specialistId: string) {
  return api.get<DoctorServiceLink[]>(`/api/specialists/${specialistId}/services`)
}

// ── Pricing matrix (P1) ─────────────────────────────────────────────────────────

export interface ApplicationScope {
  id: string
  name: string
  displayName: string
  quantityMode: 'single' | 'multi'
  maxQuantity: number | null
  /** 'none' (no variants) | 'plain' (variants, no class) | 'tooth_class'. */
  variantType: 'none' | 'plain' | 'tooth_class'
  sortOrder: number
  isActive: boolean
  /** Set when retired (soft-deleted). Only present when the list opted in. */
  deletedAt?: string | null
}

/** A stackable output/sales tax (VAT/NHIL/GETFund). rate is a fraction (0.15). */
export interface SalesTax {
  id: string
  taxType: string
  rate: number
  applicableTo: string
}

export const getSalesTaxes = () => api.get<SalesTax[]>('/api/services/taxes')

export interface ToothClass {
  id: string
  name: string
  displayName: string
  sortOrder: number
  isActive: boolean /** Set when retired (soft-deleted). */
  deletedAt?: string | null
}

/** One matrix cell = a priced (variant × tooth-class) combination for a service. */
export interface ServicePriceCell {
  id: string
  serviceId: string
  serviceCode: string | null
  variantName: string | null
  toothClassId: string | null
  price: number
  priceMin: number | null
  priceMax: number | null
  sortOrder: number
  isActive: boolean
}

export interface ServiceMatrix {
  service: Record<string, unknown> & {
    id: string
    name: string
    amount: number
    serviceCode: string | null
    scopeId: string | null
    priceMin: number | null
    priceMax: number | null
    variantsEnabled: boolean
    priceRangeEnabled: boolean
    taxIds: string[]
  }
  scope: ApplicationScope | null
  cells: ServicePriceCell[]
  variants: string[]
  toothClasses: ToothClass[]
}

export interface ResolvedPrice {
  serviceId: string
  name: string
  unitPrice: number
  quantity: number
  priceMin: number | null
  priceMax: number | null
  taxStatus: string
  discountEligible: boolean
  cell: {
    id: string
    serviceCode: string | null
    variantName: string | null
    toothClassId: string | null
  } | null
}

const lookupQuery = (includeInactive: boolean, includeDeleted: boolean) => {
  const q = new URLSearchParams()
  if (includeInactive) q.set('all', '1')
  // Separate flags on purpose: "inactive" (not offered now) and "retired"
  // (soft-deleted) are different states, and `?all=1` must never imply deleted.
  if (includeDeleted) q.set('includeDeleted', '1')
  const qs = q.toString()
  return qs ? `?${qs}` : ''
}

export const getApplicationScopes = (includeInactive = false, includeDeleted = false) =>
  api.get<ApplicationScope[]>(`/api/services/scopes${lookupQuery(includeInactive, includeDeleted)}`)

export const createApplicationScope = (data: {
  name: string
  displayName?: string
  quantityMode?: 'single' | 'multi'
  variantType?: 'none' | 'plain' | 'tooth_class'
  maxQuantity?: number | null
  sortOrder?: number
}) => api.post<ApplicationScope>('/api/services/scopes', data)

export const updateApplicationScope = (
  id: string,
  data: {
    displayName?: string
    quantityMode?: 'single' | 'multi'
    variantType?: 'none' | 'plain' | 'tooth_class'
    maxQuantity?: number | null
    sortOrder?: number
    isActive?: boolean
  }
) => api.patch<ApplicationScope>(`/api/services/scopes/${id}`, data)

export const getToothClasses = (includeInactive = false, includeDeleted = false) =>
  api.get<ToothClass[]>(
    `/api/services/tooth-classes${lookupQuery(includeInactive, includeDeleted)}`
  )

export const createToothClass = (data: {
  name: string
  displayName?: string
  sortOrder?: number
}) => api.post<ToothClass>('/api/services/tooth-classes', data)

export const updateToothClass = (
  id: string,
  data: { displayName?: string; sortOrder?: number; isActive?: boolean }
) => api.patch<ToothClass>(`/api/services/tooth-classes/${id}`, data)

export const getServiceMatrix = (serviceId: string) =>
  api.get<ServiceMatrix>(`/api/services/${serviceId}/prices`)

export const setServiceMatrix = (
  serviceId: string,
  cells: Array<{
    variantName?: string | null
    toothClassId?: string | null
    serviceCode?: string | null
    price: number
    priceMin?: number | null
    priceMax?: number | null
    sortOrder?: number
  }>
) => api.put<ServiceMatrix>(`/api/services/${serviceId}/prices`, { cells })

export const resolveServicePrice = (input: {
  serviceId: string
  variantName?: string | null
  toothClassId?: string | null
  quantity?: number | null
}) => api.post<ResolvedPrice>('/api/services/resolve-price', input)

// ── Soft deletes (0207) ──────────────────────────────────────────────────────
// The row is retired, not removed — historical invoice lines still resolve it.
// The API answers 409 with a human-readable `error` when the row carries billing
// history; surface that message rather than a generic failure.

export const deleteService = (id: string) => api.delete<{ id: string }>(`/api/services/${id}`)

export const deleteApplicationScope = (id: string) =>
  api.delete<{ id: string }>(`/api/services/scopes/${id}`)

export const deleteToothClass = (id: string) =>
  api.delete<{ id: string }>(`/api/services/tooth-classes/${id}`)

export const restoreService = (id: string) =>
  api.post<{ id: string }>(`/api/services/${id}/restore`, {})

export const restoreApplicationScope = (id: string) =>
  api.post<{ id: string }>(`/api/services/scopes/${id}/restore`, {})

export const restoreToothClass = (id: string) =>
  api.post<{ id: string }>(`/api/services/tooth-classes/${id}/restore`, {})
