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

export interface SeedTaxBracketsResult {
  inserted: number
  year: number
  /** Tax types left untouched because the year already had rows for them. */
  skipped: string[]
  /** Tax types actually written. */
  seeded: string[]
}

/**
 * Seeds the standard defaults for a year.
 *
 * Additive unless `replace` is set: the backend fills in only the tax types
 * the year is missing. Passing `replace` wipes every bracket row for the year
 * first, which it refuses (409 ACTIVE_RUNS_EXIST) while a non-archived payroll
 * run intersects that year.
 */
export async function seedTaxBrackets(year: number, replace = false) {
  return api.post<SeedTaxBracketsResult>('/api/payroll/tax-brackets/seed', {
    bracketYear: year,
    replace,
  })
}
