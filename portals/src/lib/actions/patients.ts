import { api } from '@/lib/api-client'
import type { patients } from '@/lib/db/schema'

export type PatientListParams = {
  limit?: number
  offset?: number
  q?: string
  /** admin-v1 §2.7 — filter by tag ids (sent as repeated `tagIds[]=`). */
  tagIds?: string[]
  /** C5 — true shows only archived patients; omitted/false shows active ones. */
  archived?: boolean
}

/** admin-v1 §2.7 — per-tag counts surfaced by the filter chips. */
export type PatientTagCount = { tagId: string; name: string; count: number }

export type PatientListPage<T = any> = {
  success: boolean
  data: T[]
  total: number
  tagCounts: PatientTagCount[]
  error?: string
}

export async function getPatients() {
  const res = await api.get<any[]>('/api/patients')
  return { success: res.success, data: res.data || [], error: res.error }
}

/**
 * Server-paginated patient list. Use this on the main records page; the
 * unpaginated `getPatients()` is preserved for picker dialogs that need every
 * patient in memory.
 */
export async function getPatientsPage<T = any>(
  params: PatientListParams = {}
): Promise<PatientListPage<T>> {
  const search = new URLSearchParams()
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  if (params.offset !== undefined) search.set('offset', String(params.offset))
  if (params.q) search.set('q', params.q)
  // §2.7 — repeated `tagIds[]=<id>` (backend filters the list by tag).
  for (const id of params.tagIds ?? []) search.append('tagIds[]', id)
  if (params.archived) search.set('archived', 'true')
  const qs = search.toString()
  const res = await api.get<T[]>(`/api/patients${qs ? `?${qs}` : ''}`)
  const raw = res as any
  return {
    success: res.success,
    data: (res.data as T[]) || [],
    total: typeof raw.total === 'number' ? raw.total : 0,
    tagCounts: Array.isArray(raw.tagCounts) ? (raw.tagCounts as PatientTagCount[]) : [],
    error: res.error,
  }
}

export async function getPatient(id: string) {
  const res = await api.get<any>(`/api/patients/${id}`)
  return { success: res.success, data: res.data, error: res.error }
}

// §2.7 — create/update accept `tagIds` alongside the patient fields. The base
// insert type comes from Drizzle's $inferInsert; `tagIds` is an API-layer
// extension (junction write), so it's added on top of the schema type.
export async function createPatient(data: typeof patients.$inferInsert & { tagIds?: string[] }) {
  const res = await api.post<any>('/api/patients', data)
  return res
}

export async function updatePatient(
  id: string,
  data: Partial<typeof patients.$inferInsert> & { tagIds?: string[] }
) {
  const res = await api.patch<any>(`/api/patients/${id}`, data)
  return res
}

// C5 — patients are archived (soft-delete), not hard-deleted. Permanent
// delete is a separate, password-gated action for the Archived view.
export async function archivePatient(id: string) {
  const res = await api.post<typeof patients.$inferSelect>(`/api/patients/${id}/archive`, {})
  return res
}

export async function unarchivePatient(id: string) {
  const res = await api.post<typeof patients.$inferSelect>(`/api/patients/${id}/unarchive`, {})
  return res
}

export async function permanentlyDeletePatient(id: string, password: string) {
  const res = await api.delete<{ success: boolean }>(`/api/patients/${id}/permanent`, {
    body: { password },
  })
  return res
}
