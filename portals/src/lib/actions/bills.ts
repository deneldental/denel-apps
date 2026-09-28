import { api } from '@/lib/api-client'

export type BillStatus = 'draft' | 'posted' | 'partially_paid' | 'paid' | 'void'

export type BillLine = {
  id: string
  billId: string
  description: string
  quantity: number
  unitPrice: number
  taxRate: number
  taxAmount: number
  lineTotal: number
  expenseAccountId: string
  expenseAccount?: { id: string; code: string; name: string }
}

export type Bill = {
  id: string
  billNumber: string
  supplierBillRef: string | null
  supplierId: string
  issueDate: string
  dueDate: string
  subtotal: number
  taxTotal: number
  total: number
  amountPaid: number
  balance: number
  status: BillStatus
  journalEntryId: string | null
  notes: string | null
  postedAt: string | null
  voidedAt: string | null
  createdAt: string
  supplier?: { id: string; name: string }
  lines?: BillLine[]
}

export type CreateBillInput = {
  supplierId: string
  supplierBillRef?: string | null
  issueDate?: string
  dueDate?: string
  notes?: string | null
  lines: Array<{
    description: string
    quantity?: number
    unitPrice: number
    taxRate?: number
    expenseAccountId: string
  }>
}

export type PayBillInput = {
  amount: number
  method: 'cash' | 'card' | 'transfer' | 'momo' | 'bank_transfer' | 'cheque' | 'insurance'
  paymentDate?: string
  externalReference?: string | null
  description?: string | null
}

export async function listBills(opts?: { status?: BillStatus; supplierId?: string }) {
  const params = new URLSearchParams()
  if (opts?.status) params.set('status', opts.status)
  if (opts?.supplierId) params.set('supplierId', opts.supplierId)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await api.get<Bill[]>(`/api/bills${qs}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function getBill(id: string) {
  return api.get<Bill>(`/api/bills/${id}`)
}

export async function createDraftBill(input: CreateBillInput) {
  return api.post<Bill>('/api/bills', input)
}

export async function postBillById(id: string) {
  return api.post<{ bill: Bill; journalEntry: { id: string; entryNumber: string } }>(
    `/api/bills/${id}/post`,
    {}
  )
}

export async function voidBill(id: string, reason: string) {
  return api.post<{ bill: Bill }>(`/api/bills/${id}/void`, { reason })
}

export async function payBill(id: string, input: PayBillInput) {
  return api.post<{
    payment: { id: string; paymentNumber: string }
    journalEntry: { id: string; entryNumber: string }
  }>(`/api/bills/${id}/pay`, input)
}

export async function getSupplierApBalance(supplierId: string) {
  return api.get<{ apBalance: number }>(`/api/bills/supplier/${supplierId}/balance`)
}
