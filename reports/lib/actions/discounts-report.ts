import { z } from 'zod'
import { moneySchema as money, parseReport } from '@/lib/actions/report-schema'
import { api } from '@/lib/api-client'

const lineDiscountRowSchema = z.object({
  source: z.literal('invoice_line'),
  invoiceNumber: z.string(),
  issueDate: z.string().nullable(),
  amount: money,
  reason: z.string().nullable(),
  authorizerId: z.string().nullable(),
  authorizerName: z.string().nullable(),
  providerId: z.string().nullable(),
  providerName: z.string().nullable(),
})

export type LineDiscountRow = z.infer<typeof lineDiscountRowSchema>

const creditNoteDiscountRowSchema = z.object({
  source: z.literal('credit_note'),
  creditNoteNumber: z.string(),
  invoiceNumber: z.string(),
  issueDate: z.string(),
  amount: money,
  reason: z.string().nullable(),
  authorizerId: z.string().nullable(),
  authorizerName: z.string().nullable(),
})

export type CreditNoteDiscountRow = z.infer<typeof creditNoteDiscountRowSchema>

const discountsReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  lineDiscounts: z.array(lineDiscountRowSchema),
  creditNoteDiscounts: z.array(creditNoteDiscountRowSchema),
  totals: z.object({
    lineDiscounts: money,
    creditNoteDiscounts: money,
    total: money,
  }),
})

export type DiscountsReport = z.infer<typeof discountsReportSchema>

export async function getDiscountsReport(from: string, to: string) {
  const res = await api.get<unknown>(
    `/api/reports/discounts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  )
  return parseReport(discountsReportSchema, res)
}
