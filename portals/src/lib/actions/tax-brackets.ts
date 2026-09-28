import { api } from '@/lib/api-client'

export interface TaxBracketRow {
  id: string
  bracketYear: number
  taxType: 'paye' | 'ssnit_employee' | 'ssnit_employer'
  lowerBoundMonthly: string | number
  upperBoundMonthly: string | number | null
  ratePercent: string | number
  isActive: boolean
  createdAt: string
}

export interface GetTaxBracketsResponse {
  year: number
  rows: TaxBracketRow[]
}

export async function getTaxBrackets(year: number) {
  return api.get<GetTaxBracketsResponse>(`/api/payroll/tax-brackets?year=${year}`)
}

export async function createTaxBracket(payload: {
  bracketYear: number
  taxType: 'paye' | 'ssnit_employee' | 'ssnit_employer'
  lowerBoundMonthly: number
  upperBoundMonthly: number | null
  ratePercent: number
  isActive?: boolean
}) {
  return api.post<TaxBracketRow>('/api/payroll/tax-brackets', payload)
}

export async function updateTaxBracket(
  id: string,
  payload: {
    lowerBoundMonthly?: number
    upperBoundMonthly?: number | null
    ratePercent?: number
    isActive?: boolean
  }
) {
  return api.patch<TaxBracketRow>(`/api/payroll/tax-brackets/${id}`, payload)
}

export async function deleteTaxBracket(id: string) {
  return api.delete<{ success: boolean }>(`/api/payroll/tax-brackets/${id}`)
}

export async function seedTaxBrackets(year: number, replace = false) {
  return api.post<{ inserted: number; year: number }>('/api/payroll/tax-brackets/seed', {
    bracketYear: year,
    replace,
  })
}
