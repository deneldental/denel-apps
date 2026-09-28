import { z } from 'zod'
import { moneySchema as money, parseReport } from '@/lib/actions/report-schema'
import { api } from '@/lib/api-client'

const deferredRevenueLineSchema = z.object({
  invoiceLineId: z.string(),
  invoiceId: z.string(),
  invoiceNumber: z.string(),
  patientId: z.string().nullable(),
  description: z.string(),
  lineAfterDiscount: money,
  recognizedAmount: money,
  remainingDeferred: money,
  revenueAccountCode: z.string(),
  revenueAccountName: z.string(),
})

export type DeferredRevenueLine = z.infer<typeof deferredRevenueLineSchema>

const deferredRevenueListSchema = z.array(deferredRevenueLineSchema)

export async function listDeferredLines(opts?: { outstandingOnly?: boolean }) {
  const params = new URLSearchParams()
  if (opts?.outstandingOnly === false) params.set('outstandingOnly', 'false')
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await api.get<unknown>(`/api/deferred-revenue${qs}`)
  return parseReport(deferredRevenueListSchema, res)
}
