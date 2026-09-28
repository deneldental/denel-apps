import { api } from '@/lib/api-client'

export type DeferredRevenueTrigger = 'manual' | 'milestone' | 'period_close'

export type DeferredRevenueLine = {
  invoiceLineId: string
  invoiceId: string
  invoiceNumber: string
  patientId: string | null
  description: string
  lineAfterDiscount: number
  recognizedAmount: number
  remainingDeferred: number
  revenueAccountCode: string
  revenueAccountName: string
}

export type DeferredRevenueEvent = {
  id: string
  invoiceLineId: string
  amount: number
  trigger: DeferredRevenueTrigger
  milestoneRef: string | null
  recognizedAt: string
  recognizedBy: string
  journalEntryId: string | null
  notes: string | null
  reversed: string | null
}

export async function listDeferredLines(opts?: { outstandingOnly?: boolean; invoiceId?: string }) {
  const params = new URLSearchParams()
  if (opts?.outstandingOnly === false) params.set('outstandingOnly', 'false')
  if (opts?.invoiceId) params.set('invoiceId', opts.invoiceId)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await api.get<DeferredRevenueLine[]>(`/api/deferred-revenue${qs}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function listLineEvents(invoiceLineId: string) {
  const res = await api.get<DeferredRevenueEvent[]>(
    `/api/deferred-revenue/line/${invoiceLineId}/events`
  )
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function recognizeRevenue(
  invoiceLineId: string,
  input: {
    amount: number
    trigger?: DeferredRevenueTrigger
    milestoneRef?: string | null
    notes?: string | null
    entryDate?: string
  }
) {
  return api.post<{
    event: DeferredRevenueEvent
    journalEntry: { id: string; entryNumber: string }
    remainingDeferred: string
  }>(`/api/deferred-revenue/line/${invoiceLineId}/recognize`, input)
}

export async function setLineDeferred(invoiceLineId: string, deferRevenue: boolean) {
  return api.patch<{ id: string; deferRevenue: boolean }>(
    `/api/deferred-revenue/line/${invoiceLineId}`,
    { deferRevenue }
  )
}
