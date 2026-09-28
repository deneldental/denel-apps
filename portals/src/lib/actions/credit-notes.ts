import { api } from '@/lib/api-client'

export type CreditNoteReason = 'discount' | 'correction' | 'cancellation' | 'goodwill' | 'write_off'

export type CreditNoteStatus = 'draft' | 'posted' | 'void'

export type CreditNote = {
  id: string
  creditNoteNumber: string
  invoiceId: string
  patientId: string
  issueDate: string
  reason: CreditNoteReason
  reasonNotes: string | null
  amount: number
  status: CreditNoteStatus
  journalEntryId: string | null
  postedAt: string | null
  voidedAt: string | null
  createdAt: string
}

export type CreditNoteLine = {
  id: string
  creditNoteId: string
  invoiceLineId: string | null
  amount: number
  revenueAccountId: string
  description: string | null
}

export type CreateCreditNoteInput = {
  invoiceId: string
  reason: CreditNoteReason
  amount?: number
  reasonNotes?: string | null
  issueDate?: string
  lines?: Array<{
    invoiceLineId?: string | null
    amount: number
    revenueAccountId?: string | null
    description?: string | null
  }>
}

export async function listCreditNotes(opts?: {
  status?: CreditNoteStatus
  invoiceId?: string
  patientId?: string
}) {
  const params = new URLSearchParams()
  if (opts?.status) params.set('status', opts.status)
  if (opts?.invoiceId) params.set('invoiceId', opts.invoiceId)
  if (opts?.patientId) params.set('patientId', opts.patientId)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await api.get<CreditNote[]>(`/api/credit-notes${qs}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function getCreditNote(id: string) {
  return api.get<CreditNote & { lines: CreditNoteLine[] }>(`/api/credit-notes/${id}`)
}

export async function createDraftCreditNote(input: CreateCreditNoteInput) {
  return api.post<CreditNote>('/api/credit-notes', input)
}

export async function createAndPostCreditNote(
  input: CreateCreditNoteInput & { includeTaxReversal?: boolean }
) {
  return api.post<{ creditNote: CreditNote; journalEntry: { id: string; entryNumber: string } }>(
    '/api/credit-notes/create-and-post',
    input
  )
}

export async function postCreditNote(id: string, opts?: { includeTaxReversal?: boolean }) {
  return api.post<{ creditNote: CreditNote; journalEntry: { id: string; entryNumber: string } }>(
    `/api/credit-notes/${id}/post`,
    opts ?? {}
  )
}

export async function voidCreditNote(id: string, reason: string) {
  return api.post<{ creditNote: CreditNote }>(`/api/credit-notes/${id}/void`, { reason })
}

// ── Refunds (outgoing payment) ──────────────────────────────────────────────

export type RefundInput = {
  patientId: string
  amount: number
  method: 'cash' | 'card' | 'insurance' | 'transfer' | 'momo' | 'bank_transfer' | 'cheque'
  paymentDate?: string
  externalReference?: string | null
  description?: string | null
}

export async function postRefund(input: RefundInput) {
  return api.post<{
    payment: { id: string; paymentNumber: string }
    journalEntry: { id: string; entryNumber: string }
  }>('/api/payments/refund', input)
}
