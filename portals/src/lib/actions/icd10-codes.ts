import { api } from '@/lib/api-client'

// admin-v1 CC.1 / §2.2 — WHO ICD-10 diagnosis-code lookup.
// Read-only reference search consumed by the diagnosis-stage type-ahead picker.

export interface Icd10Code {
  id: string
  code: string
  title: string
  parentCode: string | null
  billable: boolean
  version: string
}

/** Search ICD-10 codes by code prefix or title substring. */
export function searchIcd10Codes(query: string, limit = 25) {
  const params = new URLSearchParams()
  if (query.trim()) params.set('q', query.trim())
  params.set('limit', String(limit))
  return api.get<Icd10Code[]>(`/api/icd10-codes?${params.toString()}`)
}
