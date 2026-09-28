/**
 * The single source of truth for patient gender options.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * The Add and Edit patient forms are separate ~700-line components that
 * hand-duplicate the same markup, so their gender lists silently drifted: Edit
 * offered male/female/other while Add offered only male/female. Nothing caught
 * it — the backend accepts `gender: z.string()` (routes/patients.ts), so both
 * lists were equally valid to the API.
 *
 * Every patient gender select now renders from this array. Adding or removing an
 * option is a one-line change here, and the forms cannot disagree again.
 *
 * Note the staff equivalent is a different list with a different owner:
 * `GENDERS` in `@denel/types` (packages/types/src/staff.ts). Patients and staff
 * are deliberately not coupled.
 *
 * ─── Follow-ups, deliberately not done here ──────────────────────────────────
 * • `db/schema/patients.ts:21` still comments `// 'male', 'female', 'other'`, and
 *   `analytics/pages/patient.tsx` still colours `other` (and an `unspecified`
 *   nothing produces). Harmless — they only affect how pre-existing rows render.
 * • The backend could validate `z.enum(...)` instead of `z.string()`, which would
 *   catch this class of drift at the API. That must wait until rows holding
 *   `other` are migrated, or editing those patients would start failing.
 */
export const PATIENT_GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
] as const

export type PatientGender = (typeof PATIENT_GENDERS)[number]['value']
