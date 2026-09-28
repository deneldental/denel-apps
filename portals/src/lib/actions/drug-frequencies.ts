import { api } from '@/lib/api-client'

export interface DrugFrequency {
  id: string
  /** Standard abbreviation (OD, BD, TDS, …) — the value stored on prescriptions. */
  name: string
  /** Full-text meaning (e.g. "Three times daily"). */
  displayName: string | null
  isActive?: boolean
}

const TYPE = 'drug-frequencies'

/** Seeded standard frequency abbreviations (OD/BD/TDS/…) with their meanings. */
export async function getDrugFrequencies() {
  return api.get<DrugFrequency[]>(`/api/lookups/${TYPE}`)
}
