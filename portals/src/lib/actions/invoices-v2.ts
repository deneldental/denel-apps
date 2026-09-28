import type { Cents } from '@denel/utils'
import { api } from '@/lib/api-client'

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void' | 'written_off'

export type InvoiceLine = {
  id: string
  invoiceId: string
  lineNumber: number
  treatmentId: string | null
  description: string
  quantity: number
  unitPrice: Cents
  discountType: 'none' | 'percent' | 'amount'
  /** Dual-semantic: a PERCENTAGE when discountType is 'percent', else Cents. */
  discountValue: number
  discountAmount: Cents
  lineSubtotal: Cents
  lineAfterDiscount: Cents
  /** A percentage (7.5 = 7.5%), not money. */
  taxRate: number
  taxAmount: Cents
  lineTotal: Cents
  revenueAccountId: string
  providerId: string | null
  specialistId: string | null
  commissionRate: number | null
  deferRevenue: boolean
  revenueAccount?: { id: string; code: string; name: string }
  specialist?: { id: string; name: string }
}

export type InvoiceDraft = {
  id: string
  invoiceNumber: string
  patientId: string
  status: InvoiceStatus
  currency: string
  subtotal: Cents
  discountTotal: Cents
  taxableAmount: Cents
  taxTotal: Cents
  total: Cents
  balance: Cents
  issueDate: string | null
  dueDate: string | null
  issuedAt: string | null
  voidedAt: string | null
  voidReason: string | null
  journalEntryId: string | null
}

export type IssueInvoiceResult = {
  invoice: InvoiceDraft
  journalEntry: { id: string; entryNumber: string }
}

export async function createDraftInvoice(input: {
  patientId: string
  type?: 'one_time' | 'plan_installment' | 'plan_total'
  planId?: string | null
  issueDate?: string
  dueDate?: string
  description?: string | null
  treatmentPlanId?: string | null
}) {
  return api.post<InvoiceDraft>('/api/invoices', input)
}

export async function getInvoice(invoiceId: string) {
  return api.get<InvoiceDraft>(`/api/invoices/${invoiceId}`)
}

/** Invoice row from the clinic-wide ledger list (`GET /api/invoices`), with the
 *  patient joined for display. Used by the Refunds & Reversals view to surface
 *  credit-note / void candidates without a per-patient fan-out. */
export type LedgerInvoice = InvoiceDraft & {
  patient?: { id: string; name: string; patientId: string | null; phone: string | null } | null
}

/**
 * Clinic-wide invoice list (`GET /api/invoices`), optionally filtered by status.
 * Returns the page array — the backend paginates (default 100/page); the
 * Refunds & Reversals view fetches the issued/partially-paid slice, which is
 * comfortably within one page for a clinic of this size.
 */
export async function listInvoices(opts?: { status?: InvoiceStatus; limit?: number }) {
  const params = new URLSearchParams()
  if (opts?.status) params.set('status', opts.status)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await api.get<LedgerInvoice[]>(`/api/invoices${qs}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

/**
 * All invoices for a patient. Typed against `InvoiceDraft` so the receive-
 * payment dialog no longer hand-rolls an inline `OpenInvoice` shape or reshapes
 * `res.data as any[]` (remediation M23/M24).
 */
export async function listPatientInvoices(patientId: string) {
  const res = await api.get<InvoiceDraft[]>(`/api/invoices/patient/${patientId}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

/** Subset of invoice fields returned by GET /api/payment-plans/:id/invoices —
 *  enough to render the per-invoice allocation rows without dragging in every
 *  field of InvoiceDraft. */
export interface PlanInvoiceSummary {
  id: string
  invoiceNumber: string
  type: string
  status: InvoiceStatus | 'pending' | 'partial' | 'overdue' | 'waived'
  installmentNumber: number | null
  total: number
  paidAmount: number
  balance: number
  dueDate: string | null
  description: string | null
}

export async function listPlanInvoices(planId: string) {
  const res = await api.get<PlanInvoiceSummary[]>(`/api/payment-plans/${planId}/invoices`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function listInvoiceLines(invoiceId: string) {
  const res = await api.get<InvoiceLine[]>(`/api/invoices/${invoiceId}/lines`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function addInvoiceLine(
  invoiceId: string,
  input: {
    description: string
    quantity?: number
    unitPrice: number
    discountType?: 'none' | 'percent' | 'amount'
    discountValue?: number
    taxRate?: number
    revenueAccountId: string
    providerId?: string | null
    specialistId?: string | null
    commissionRate?: number | null
    treatmentId?: string | null
    deferRevenue?: boolean
  }
) {
  return api.post<InvoiceLine>(`/api/invoices/${invoiceId}/lines`, input)
}

export async function removeInvoiceLine(invoiceId: string, lineId: string) {
  return api.delete(`/api/invoices/${invoiceId}/lines/${lineId}`)
}

export async function issueInvoice(invoiceId: string, entryDate?: string) {
  return api.post<IssueInvoiceResult>(`/api/invoices/${invoiceId}/issue`, { entryDate })
}

export async function voidInvoice(invoiceId: string, reason: string) {
  return api.post<{ invoice: InvoiceDraft }>(`/api/invoices/${invoiceId}/void`, { reason })
}

export type ApplyCreditResult = {
  applied: Array<{ paymentId: string; amount: number }>
  totalApplied: number
  remainingInvoiceBalance: number
}

/**
 * Applies the patient's unallocated credit to this invoice (FIFO across the
 * patient's open credit payments). Typed wrapper so the invoice composer no
 * longer reaches for a raw `api.post` with an inline response type (M21).
 */
export async function applyInvoiceCredit(invoiceId: string) {
  return api.post<ApplyCreditResult>(`/api/invoices/${invoiceId}/apply-credit`, {})
}

export type ArchivedInvoice = InvoiceDraft & {
  archived: boolean
  archivedAt: string | null
  archivedBy: string | null
  description?: string | null
}

export async function archiveInvoice(invoiceId: string) {
  return api.post<InvoiceDraft>(`/api/invoices/${invoiceId}/archive`, {})
}

export async function unarchiveInvoice(invoiceId: string) {
  return api.post<InvoiceDraft>(`/api/invoices/${invoiceId}/unarchive`, {})
}

export async function permanentlyDeleteInvoice(invoiceId: string, password: string) {
  return api.delete<{ success: boolean }>(`/api/invoices/${invoiceId}/permanent`, {
    body: { password },
  })
}

export async function listArchivedInvoices(patientId: string) {
  const res = await api.get<ArchivedInvoice[]>(`/api/invoices/patient/${patientId}/archived`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}
