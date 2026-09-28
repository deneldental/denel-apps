import { z } from 'zod'
import {
  countSchema as count,
  moneySchema as money,
  parseReport,
} from '@/lib/actions/report-schema'
import { api } from '@/lib/api-client'

const apAgingRowSchema = z.object({
  supplierId: z.string(),
  supplierName: z.string(),
  billCount: count,
  current: money,
  bucket30: money,
  bucket60: money,
  bucket90: money,
  total: money,
  oldestDue: z.string().nullable(),
})

export type ApAgingRow = z.infer<typeof apAgingRowSchema>

const apAgingSchema = z.object({
  asOf: z.string(),
  rows: z.array(apAgingRowSchema),
  summary: z.object({
    current: money,
    bucket30: money,
    bucket60: money,
    bucket90: money,
    total: money,
  }),
})

export type ApAgingReport = z.infer<typeof apAgingSchema>

export async function getApAging(asOf: string) {
  const res = await api.get<unknown>(`/api/reports/ap-aging?as_of=${encodeURIComponent(asOf)}`)
  return parseReport(apAgingSchema, res)
}
