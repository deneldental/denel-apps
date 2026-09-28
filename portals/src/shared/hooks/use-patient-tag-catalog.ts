import { getPatientTagCatalog, type PatientTag } from '@/lib/actions/patient-tags'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'

/**
 * The full patient-tag catalog (`/api/patient-tags`) — shared by every tag
 * picker (`<TagPicker>` on the add/edit-patient forms, `<PatientTags>` on the
 * patient record) and the Settings admin table. A save in Settings
 * invalidates `queryKeys.patientTags.all`, so a renamed/recoloured/new tag
 * shows up everywhere without a reload.
 */
export function usePatientTagCatalog(opts: { activeOnly?: boolean; enabled?: boolean } = {}) {
  const { activeOnly = false, enabled = true } = opts
  const query = useApiQuery(queryKeys.patientTags.list(), getPatientTagCatalog, {
    enabled,
    select: (rows): PatientTag[] => (activeOnly ? rows.filter((t) => t.isActive !== false) : rows),
  })
  return {
    catalog: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error ? query.error.message : null,
  }
}
