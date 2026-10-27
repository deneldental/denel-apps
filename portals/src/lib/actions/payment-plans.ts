import { type ApiResponse, api } from '@/lib/api-client'
import type { paymentPlans } from '@/lib/db/schema'

export async function getPaymentPlanByPatientId(patientId: string) {
  const res = await api.get<any>(`/api/payment-plans/patient/${patientId}`)
  return { success: res.success, data: res.data, error: res.error }
}

export async function getAllPaymentPlans() {
  const res = await api.get<any[]>('/api/payment-plans')
  return { success: res.success, data: res.data || [], error: res.error }
}

export async function createPaymentPlan(data: typeof paymentPlans.$inferInsert) {
  const res = await api.post<any>('/api/payment-plans', data)
  return res
}

/** Structured-lines variant: composes a master invoice from explicit line
 *  items so each line snapshots its specialist + commission rate. The backend
 *  route auto-detects the presence of `lines[]` and routes to the new path. */
export interface CreatePaymentPlanLine {
  treatmentId?: string | null
  serviceId?: string | null
  description: string
  quantity: number
  unitPrice: number
  discountType?: 'none' | 'percent' | 'amount'
  discountValue?: number
  specialistId?: string | null
  commissionRate?: number | null
}

export async function createPaymentPlanWithLines(input: {
  patientId: string
  scheduleType: 'fixed' | 'flexible'
  startDate?: string | Date
  numberOfInstallments?: number
  paymentFrequency?: 'weekly' | 'biweekly' | 'monthly'
  templateId?: string | null
  notes?: string | null
  lines: CreatePaymentPlanLine[]
  /** When true, backend sends the plan-created SMS to the patient. */
  sendSms?: boolean
  /**
   * Estimate this plan is built from. The backend converts that invoice into
   * the plan's master rather than minting a second one, so the treatment is
   * billed once. `lines` is then ignored server-side — the plan bills the
   * estimate exactly, and corrections go through a credit note.
   */
  sourceInvoiceId?: string | null
}) {
  const payload = {
    patientId: input.patientId,
    type: input.scheduleType,
    startDate:
      input.startDate instanceof Date
        ? input.startDate.toISOString()
        : (input.startDate ?? new Date().toISOString()),
    numberOfInstallments: input.numberOfInstallments,
    paymentFrequency: input.paymentFrequency,
    templateId: input.templateId ?? null,
    notes: input.notes ?? null,
    lines: input.lines,
    sendSms: input.sendSms ?? false,
    sourceInvoiceId: input.sourceInvoiceId ?? null,
  }
  return api.post<any>('/api/payment-plans', payload)
}

export async function pausePaymentPlan(id: string) {
  const res = await api.patch<any>(`/api/payment-plans/${id}/pause`, {})
  return res
}

export async function unpausePaymentPlan(id: string) {
  const res = await api.patch<any>(`/api/payment-plans/${id}/unpause`, {})
  return res
}

export async function updatePaymentPlan(
  id: string,
  data: Partial<typeof paymentPlans.$inferInsert>
) {
  const res = await api.patch<any>(`/api/payment-plans/${id}`, data)
  return res
}

export async function deletePaymentPlan(id: string) {
  const res = await api.delete<any>(`/api/payment-plans/${id}`)
  return res
}

export async function archivePaymentPlan(id: string) {
  return api.post<any>(`/api/payment-plans/${id}/archive`, {})
}

export async function unarchivePaymentPlan(id: string) {
  return api.post<any>(`/api/payment-plans/${id}/unarchive`, {})
}

export async function permanentlyDeletePaymentPlan(id: string, password: string) {
  return api.delete<any>(`/api/payment-plans/${id}/permanent`, { body: { password } })
}

export async function getArchivedPaymentPlansByPatient(patientId: string) {
  return api.get<any[]>(`/api/payment-plans/patient/${patientId}/archived`)
}

/**
 * Plans marked overdue AND outstanding (the dashboard card and the reminders page want both).
 * Pass `status` to get one kind only; the Payments page's Overdue tab does.
 */
export async function getOverduePaymentPlans(status?: 'overdue' | 'outstanding') {
  const res = await api.get<any[]>(
    status ? `/api/payment-plans/overdue?status=${status}` : '/api/payment-plans/overdue'
  )
  return res.data || []
}

export async function getOutstandingPaymentPlans() {
  const res = await api.get<any[]>('/api/payment-plans/outstanding')
  return res.data || []
}

/** One payment in a plan's history. Amounts are integer cents. */
export interface PaymentPlanHistoryPayment {
  id: string
  paymentNumber: string | null
  paymentDate: string | null
  createdAt: string
  method: string
  /** 'posted' counts toward what has been received; 'reversed' is shown for the record. */
  status: 'posted' | 'reversed'
  /** The whole payment. */
  amount: number
  /** The part of it applied to this plan's invoices. */
  appliedToPlan: number
  description: string | null
  paymentGroupId: string | null
}

/** `GET /api/payment-plans/:id`. Amounts are integer cents. */
export interface PaymentPlanDetail {
  id: string
  planNumber: string | null
  patientId: string
  type: string
  scheduleType: string | null
  status: string
  archived: boolean
  startDate: string
  endDate: string | null
  notes: string | null
  originalAmount: number
  discountAmount: number
  totalAmount: number
  amountPerInstallment: number | null
  numberOfInstallments: number | null
  paymentFrequency: string | null
  installmentPeriod: string | null
  createdAt: string
  patient: {
    id: string
    name: string
    phone: string | null
    email: string | null
    patientId: string | null
    isChild: boolean
    guardianPhone: string | null
  }
  /** The master invoice, or null for an old plan that only has per-installment invoices. */
  invoice: {
    id: string
    invoiceNumber: string
    status: string
    total: number
    paidAmount: number
    balance: number
  } | null
  /** `paid` is the sum of POSTED allocations to the plan's invoices; `balance` what the master invoice still owes. */
  totals: { total: number; paid: number; balance: number }
  payments: PaymentPlanHistoryPayment[]
}

export async function getPaymentPlanDetails(id: string): Promise<ApiResponse<PaymentPlanDetail>> {
  return api.get<PaymentPlanDetail>(`/api/payment-plans/${id}`)
}

export async function updatePaymentAmount(paymentId: string, newAmount: number) {
  const res = await api.patch<any>(`/api/payments/${paymentId}`, { amount: newAmount })
  return res
}
