import { api } from '@/lib/api-client'

/** One row of the Activity worklist — a visit enriched with billing + clinical state. */
export interface WorklistVisit {
  appointmentId: string
  patientId: string
  patientName: string
  patientPhone: string | null
  doctorId: string
  doctorName: string | null
  date: string
  status: string
  type: string
  requiresEstimate: boolean
  /** null | 'awaiting_estimate' | 'estimate_ready' | 'invoiced' */
  estimateStatus: string | null
  checkedInAt: string | null
  hasPendingNote: boolean
  /**
   * Payment gate — decided server-side by the same rule the backend enforces.
   * Do not re-derive on the client: it cannot see payment plans or insurance
   * cover, and would report a plan-covered visit as blocked.
   */
  treatmentBlocked?: boolean
  treatmentBlockedReason?: string | null
  /** The estimate = the invoice linked to this visit (draft, then issued). */
  estimateInvoiceId: string | null
  estimateTotal: number | null
  estimateInvoiceStatus: string | null
  treatmentPlanId: string | null
}

export interface WorklistResponse {
  date: string
  visits: WorklistVisit[]
  /**
   * Doctor lens only: true when no `doctors` row is linked to the signed-in
   * user, so the empty list is a misconfiguration rather than a quiet day.
   */
  unlinked?: boolean
}

/** Doctor's day-sheet queue. Admins may pass doctorId; omit → all doctors. */
export const getDoctorWorklist = (date?: string, doctorId?: string) => {
  const q = new URLSearchParams()
  if (date) q.set('date', date)
  if (doctorId) q.set('doctorId', doctorId)
  const qs = q.toString()
  return api.get<WorklistResponse>(`/api/worklist/doctor${qs ? `?${qs}` : ''}`)
}

/** Reception's billing lens over the day's visits. */
export const getReceptionWorklist = (date?: string) =>
  api.get<WorklistResponse>(`/api/worklist/reception${date ? `?date=${date}` : ''}`)

// ── Estimate lifecycle (P3/P4) ───────────────────────────────────────────────

export interface EstimateLineInput {
  serviceId: string
  quantity?: number
  variantName?: string | null
  toothClassId?: string | null
  specialistId?: string | null
  // No reason/eligibility gate, unlike discount — see invoice-lines.ts (0215).
  surcharge?: { type: 'percent' | 'amount'; value: number } | null
  discount?: { type: 'percent' | 'amount'; value: number; reason?: string | null } | null
}

/** P3 — doctor builds (or replaces) the estimate draft for a visit. */
export const createEstimate = (
  appointmentId: string,
  lines: EstimateLineInput[],
  note?: string | null,
  visitFrequency: 'single' | 'multiple' = 'single'
) =>
  api.post<{ invoiceId: string; total: number; lineCount: number }>(
    `/api/worklist/${appointmentId}/estimate`,
    { lines, note, visitFrequency }
  )

/** Estimates Tab — doctor builds a standalone estimate for a patient. */
export const createStandaloneEstimate = (
  patientId: string,
  lines: EstimateLineInput[],
  note?: string | null,
  visitFrequency: 'single' | 'multiple' = 'single',
  planId?: string
) =>
  api.post<{ invoiceId: string; total: number; lineCount: number }>(`/api/invoices/estimate`, {
    patientId,
    lines,
    note,
    visitFrequency,
    planId,
  })

/**
 * Doctor action — turn an estimate into a draft treatment plan. Items copy the
 * estimate's resolved line prices, so the plan total matches what the patient
 * was quoted.
 */
export const createTreatmentPlanFromEstimate = (invoiceId: string, title?: string | null) =>
  api.post<{ id: string; title: string }>('/api/treatment-plans/from-invoice', {
    invoiceId,
    title: title ?? undefined,
  })

export interface ConfirmPaymentInput {
  method: string
  amount: number
  externalReference?: string | null
}

/** P4 — reception issues the estimate (posts AR) + optionally records payment(s). */
export const confirmEstimate = (appointmentId: string, payments?: ConfirmPaymentInput[]) =>
  api.post<{ invoiceId: string; paymentId: string | null }>(
    `/api/worklist/${appointmentId}/confirm`,
    { payments }
  )

/** P4 — reception cancels the un-issued estimate draft. */
export const cancelEstimate = (appointmentId: string) =>
  api.post<{ cancelled: number }>(`/api/worklist/${appointmentId}/cancel`, {})

/** P5 — escape hatch: re-route a visit between doctor-first and reception-direct. */
export const routeVisit = (appointmentId: string, requiresEstimate: boolean) =>
  api.post<{ requiresEstimate: boolean }>(`/api/worklist/${appointmentId}/route`, {
    requiresEstimate,
  })
