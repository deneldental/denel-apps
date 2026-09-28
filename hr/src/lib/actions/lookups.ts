import { api } from '@/lib/api-client'

export interface LookupRow {
  id: string
  name: string
  displayName: string | null
  isActive: boolean
}

/** Behaviour class on an employment type — see EMPLOYMENT_KINDS in @denel/types. */
export type EmploymentKindValue = 'permanent' | 'contract' | 'trainer'

export interface EmploymentTypeRow extends LookupRow {
  /**
   * What the code keys off. Admins own the label; this decides behaviour —
   * `contract` means a contract end date applies, `trainer` marks external
   * trainers. Never branch on `name`.
   */
  kind: EmploymentKindValue
}

const BASE = '/api/lookups/staff-document-types'

/** Active staff document types (for the upload dropdown). */
export function listStaffDocumentTypes() {
  return api.get<LookupRow[]>(BASE)
}

/** All staff document types incl. inactive (admin settings view). */
export function listAllStaffDocumentTypes() {
  return api.get<LookupRow[]>(`${BASE}/all`)
}

export function createStaffDocumentType(input: { name: string; displayName: string }) {
  return api.post<LookupRow>(BASE, input)
}

export function updateStaffDocumentType(
  id: string,
  patch: { name?: string; displayName?: string; isActive?: boolean }
) {
  return api.patch(`${BASE}/${id}`, patch)
}

export function deleteStaffDocumentType(id: string) {
  return api.delete(`${BASE}/${id}`)
}

// ── Staff Titles (clinical positions) ──────────────────────────────────────────
// The "Title" a staff member picks during self-registration. Same lookup shape
// as document types; managed in HR Settings.

const TITLES_BASE = '/api/lookups/staff-titles'

/** Active titles (for the registration dropdown). */
export function listStaffTitles() {
  return api.get<LookupRow[]>(TITLES_BASE)
}

/** All titles incl. inactive (admin settings view). */
export function listAllStaffTitles() {
  return api.get<LookupRow[]>(`${TITLES_BASE}/all`)
}

export function createStaffTitle(input: { name: string; displayName: string }) {
  return api.post<LookupRow>(TITLES_BASE, input)
}

export function updateStaffTitle(
  id: string,
  patch: { name?: string; displayName?: string; isActive?: boolean }
) {
  return api.patch(`${TITLES_BASE}/${id}`, patch)
}

export function deleteStaffTitle(id: string) {
  return api.delete(`${TITLES_BASE}/${id}`)
}

// ── Employment Types (migration 0178) ────────────────────────────────────────
// Was a hard-coded enum. Admin-managed now, so HR can add e.g. "Locum (6
// months)" without a deploy. Each row carries a `kind` the admin picks at
// creation but cannot later weaponise — code branches on kind, never on name.

const EMPLOYMENT_TYPES_BASE = '/api/lookups/employment-types'

/** Active employment types (for the staff wizard + employment editor). */
export function listEmploymentTypes() {
  return api.get<EmploymentTypeRow[]>(EMPLOYMENT_TYPES_BASE)
}

/** All employment types incl. inactive (admin settings view). */
export function listAllEmploymentTypes() {
  return api.get<EmploymentTypeRow[]>(`${EMPLOYMENT_TYPES_BASE}/all`)
}

export function createEmploymentType(input: {
  name: string
  displayName: string
  kind: EmploymentKindValue
}) {
  return api.post<EmploymentTypeRow>(EMPLOYMENT_TYPES_BASE, input)
}

export function updateEmploymentType(
  id: string,
  patch: { name?: string; displayName?: string; isActive?: boolean; kind?: EmploymentKindValue }
) {
  return api.patch(`${EMPLOYMENT_TYPES_BASE}/${id}`, patch)
}

export function deleteEmploymentType(id: string) {
  return api.delete(`${EMPLOYMENT_TYPES_BASE}/${id}`)
}

// ── Departments (migration 0178) ─────────────────────────────────────────────
// Restored: 0060 added the lookup, 0154 dropped it as unused, 0174 re-added
// staff.department as an enum for self-registration (where it's required), so
// the concept is live again.

const DEPARTMENTS_BASE = '/api/lookups/hr-departments'

/** Active departments (for the staff wizard). */
export function listHrDepartments() {
  return api.get<LookupRow[]>(DEPARTMENTS_BASE)
}

/** All departments incl. inactive (admin settings view). */
export function listAllHrDepartments() {
  return api.get<LookupRow[]>(`${DEPARTMENTS_BASE}/all`)
}

export function createHrDepartment(input: { name: string; displayName: string }) {
  return api.post<LookupRow>(DEPARTMENTS_BASE, input)
}

export function updateHrDepartment(
  id: string,
  patch: { name?: string; displayName?: string; isActive?: boolean }
) {
  return api.patch(`${DEPARTMENTS_BASE}/${id}`, patch)
}

export function deleteHrDepartment(id: string) {
  return api.delete(`${DEPARTMENTS_BASE}/${id}`)
}

// ── Specialties (migration 0179) ─────────────────────────────────────────────
// Clinical specialisation for doctors. Was free text on specialists.specialty;
// now an admin-managed lookup like its siblings.

const SPECIALTIES_BASE = '/api/lookups/specialties'

/** Active specialties (for the doctor onboarding form). */
export function listSpecialties() {
  return api.get<LookupRow[]>(SPECIALTIES_BASE)
}

/** All specialties incl. inactive (admin settings view). */
export function listAllSpecialties() {
  return api.get<LookupRow[]>(`${SPECIALTIES_BASE}/all`)
}

export function createSpecialty(input: { name: string; displayName: string }) {
  return api.post<LookupRow>(SPECIALTIES_BASE, input)
}

export function updateSpecialty(
  id: string,
  patch: { name?: string; displayName?: string; isActive?: boolean }
) {
  return api.patch(`${SPECIALTIES_BASE}/${id}`, patch)
}

export function deleteSpecialty(id: string) {
  return api.delete(`${SPECIALTIES_BASE}/${id}`)
}
