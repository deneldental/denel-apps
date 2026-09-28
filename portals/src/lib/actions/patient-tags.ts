import { api } from '@/lib/api-client'

// admin-v1 §2.7 — patient tags.

export interface PatientTag {
  id: string
  name: string
  color: string
  isActive?: boolean
  isSystem?: boolean
  /**
   * Stable key for tags that drive behaviour — 'insurance', 'xray', 'lab' —
   * null for ordinary tags. Match on this, never on `name`: the display name is
   * editable in Settings, and name-matching is what let duplicate
   * 'Insurance'/'insurance' rows break the insurance-fields trigger.
   */
  systemKey?: string | null
}

/** Find a behavioural tag by its stable key. Use instead of matching names. */
export function findTagBySystemKey(
  catalog: PatientTag[],
  key: 'insurance' | 'xray' | 'lab'
): PatientTag | undefined {
  return catalog.find((t) => t.systemKey === key)
}

export function getPatientTagCatalog() {
  return api.get<PatientTag[]>('/api/patient-tags')
}
export function getPatientTags(patientId: string) {
  return api.get<PatientTag[]>(`/api/patient-tags/patient/${patientId}`)
}
export function assignPatientTag(patientId: string, tagId: string) {
  return api.post<unknown>(`/api/patient-tags/patient/${patientId}`, { tagId })
}
export function unassignPatientTag(patientId: string, tagId: string) {
  return api.delete<unknown>(`/api/patient-tags/patient/${patientId}/${tagId}`)
}
export function createPatientTag(name: string, color: string) {
  return api.post<PatientTag>('/api/patient-tags', { name, color })
}
export function updatePatientTag(
  id: string,
  patch: Partial<{ name: string; color: string; isActive: boolean }>
) {
  return api.patch<PatientTag>(`/api/patient-tags/${id}`, patch)
}
/**
 * Removes the tag from the catalog and untags every patient carrying it.
 * The server rejects this for system tags — they drive intake behaviour.
 */
export function deletePatientTag(id: string) {
  return api.delete<{ id: string; patientsUntagged: number }>(`/api/patient-tags/${id}`)
}

/**
 * Is this patient orthodontic?
 *
 * Keyed on the tag's stable `systemKey`, never its display name: admins can
 * rename "Ortho" in Settings, and the old `name === 'Ortho'` check was
 * case-sensitive, so a renamed or lowercase tag silently disabled every ortho
 * feature. `name` is kept as a fallback only for payloads served before the
 * key reached the wire.
 */
export function isOrthoPatient(
  tags: Array<{ name?: string; systemKey?: string | null }> | null | undefined
): boolean {
  if (!tags) return false
  return tags.some(
    (t) => t.systemKey === 'ortho' || (!t.systemKey && t.name?.toLowerCase() === 'ortho')
  )
}
