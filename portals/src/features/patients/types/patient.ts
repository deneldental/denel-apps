// Shared patient record shape, derived from the DB schema.
//
// admin-v1 §2.7 — patients no longer carry `type`/`isOrtho`; they carry `tags`.
// Omit the legacy columns (whether or not the backend has dropped them yet) and
// add the API-supplied `tags` relation.

import type { PatientTag } from '@/lib/actions/patient-tags'
import type { patients } from '@/lib/db/schema'

export type Patient = Omit<typeof patients.$inferSelect, 'type' | 'isOrtho'> & {
  tags?: PatientTag[]
}
