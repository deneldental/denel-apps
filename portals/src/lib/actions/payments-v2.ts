import type { Cents } from '@denel/utils'
import { api } from '@/lib/api-client'

export type PaymentMethod =
  | 'cash'
  | 'card'
  | 'insurance'
  | 'transfer'
  | 'momo'
  | 'bank_transfer'
  | 'cheque'
  /** Pays from the patient's existing deposit balance — surfaces in the
   *  transactions list with its own receipt, unlike the legacy apply-credit
   *  flow which was invisible. */
  | 'wallet'

export type PaymentStatus = 'draft' | 'posted' | 'reversed'

export type AllocationInput = {
  targetType: 'invoice' | 'bill'
  targetId: string
  amount: Cents
  notes?: string | null
}

export type DraftPaymentInput = {
  patientId: string
  amount: Cents
  method: PaymentMethod
  paymentDate?: string
  externalReference?: string | null
  description?: string | null
  appointmentId?: string | null
  paymentPlanId?: string | null
  allocations?: AllocationInput[]
  /** Shared id when this is one source in a split payment so the receipt
   *  endpoint can pull sibling payments and render combined methods. */
  paymentGroupId?: string | null
}

export type Payment = {
  id: string
  paymentNumber: string | null
  patientId: string | null
  amount: Cents
  allocatedAmount: Cents
  unallocatedAmount: Cents
  method: PaymentMethod
  status: PaymentStatus
  paymentDate: string | null
  externalReference: string | null
  description: string | null
  channelAccountId: string | null
  journalEntryId: string | null
  postedAt: string | null
  reversedAt: string | null
  createdAt: string
}

export type PaymentAllocation = {
  id: string
  paymentId: string
  targetType: 'invoice' | 'bill'
  targetId: string
  amount: Cents
  allocatedAt: string
  notes: string | null
}

export type PatientCredit = {
  depositBalance: Cents
  arBalance: Cents
}

/**
 * A patient carrying unallocated credit (deposit_balance > 0), as returned by
 * `GET /api/payments/patients-with-credit` — one query instead of the old
 * per-patient N+1 fan-out (remediation H19).
 */
export type PatientWithCredit = {
  patientId: string
  name: string
  /** Clinic-facing patient code, if any. */
  patientCode?: string | null
  depositBalance: number
}

// A longer-than-default timeout: each call wraps a multi-table DB transaction
// (invoices, payments, allocations, journal entries, GL balances) which on the
// Neon dev/staging branch can occasionally run past the default 30s under
// connection-reconnect latency — a false client timeout here is worse than a
// slow spinner, since the server-side transaction isn't cancelled by the
// client giving up, risking staff re-submitting a payment that already posted.
const PAYMENT_WRITE_TIMEOUT_MS = 60_000

export async function createDraftPayment(input: DraftPaymentInput) {
  return api.post<Payment>('/api/payments/draft', input, { timeout: PAYMENT_WRITE_TIMEOUT_MS })
}

/**
 * Post a draft payment. `sendSms` asks the server to text the patient a payment confirmation (G08):
 * it names what has been posted, the whole group for a split, so ask for it with the LAST payment
 * of a group. The server texts an event at most once; a failed text comes back as `smsError`.
 */
export async function postDraftPayment(id: string, opts: { sendSms?: boolean } = {}) {
  return api.post<{ payment: Payment; journalEntry: { id: string; entryNumber: string } }>(
    `/api/payments/${id}/post`,
    opts.sendSms ? { sendSms: true } : {},
    { timeout: PAYMENT_WRITE_TIMEOUT_MS }
  )
}

export async function reversePostedPayment(id: string, reason: string) {
  return api.post<{ payment: Payment }>(`/api/payments/${id}/reverse`, { reason })
}

export async function applyPatientCredit(paymentId: string, invoiceId: string, amount: number) {
  return api.post<{ payment: Payment; allocation: PaymentAllocation }>(
    `/api/payments/${paymentId}/apply-credit`,
    { invoiceId, amount }
  )
}

export async function getPaymentAllocations(paymentId: string) {
  const res = await api.get<PaymentAllocation[]>(`/api/payments/${paymentId}/allocations`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function getPatientCredit(patientId: string) {
  return api.get<PatientCredit>(`/api/payments/patient/${patientId}/credit`)
}

/**
 * Fetches every patient with a positive deposit balance in a single request.
 * Replaces the `getPatients()` + per-patient `getPatientCredit()` loop on the
 * /refunds page (remediation H19 — the loop scaled with the whole patient table).
 */
export async function getPatientsWithCredit() {
  const res = await api.get<PatientWithCredit[]>('/api/payments/patients-with-credit')
  return { success: res.success, data: res.data ?? [], error: res.error }
}
