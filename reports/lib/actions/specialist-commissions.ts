import { z } from 'zod'
import {
  countSchema as count,
  moneySchema as money,
  parseReport,
} from '@/lib/actions/report-schema'
import { api } from '@/lib/api-client'

const commissionReportRowSchema = z.object({
  specialistId: z.string(),
  specialistName: z.string(),
  accrued: money,
  payable: money,
  paid: money,
  reversed: money,
  totalCommissioned: money,
  commissionCount: count,
})

export type CommissionReportRow = z.infer<typeof commissionReportRowSchema>

const commissionReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(commissionReportRowSchema),
  summary: z.object({
    accrued: money,
    payable: money,
    paid: money,
    reversed: money,
    totalCommissioned: money,
  }),
})

export type CommissionReport = z.infer<typeof commissionReportSchema>

export async function getSpecialistCommissionsReport(from: string, to: string) {
  const res = await api.get<unknown>(
    `/api/reports/specialist-commissions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  )
  return parseReport(commissionReportSchema, res)
}
