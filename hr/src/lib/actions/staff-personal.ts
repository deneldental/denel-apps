// Staff personal-data child records — contacts, qualifications, dependents,
// work experience (migration 0177).
//
// These are the one-to-many halves of the employee record that `staff` used to
// carry as single flat column sets. The backend serves all four from one
// factory (backend/src/routes/staff-personal.ts); this mirrors that shape so a
// new resource needs one entry, not four functions.

import { api } from '@/lib/api'

export type ChildResource = 'contacts' | 'qualifications' | 'dependents' | 'work-experience'

export interface StaffContact {
  id: string
  staffId: string
  type: 'emergency' | 'next_of_kin'
  /** Nullable: existing staff have an emergency phone and no name. */
  name: string | null
  relationship: string | null
  phone: string | null
  isPrimary: boolean
}

export interface StaffQualification {
  id: string
  staffId: string
  qualification: string
  institution: string | null
  year: number | null
  isHighest: boolean
}

export interface StaffDependent {
  id: string
  staffId: string
  name: string
  relationship: string | null
  dateOfBirth: string | null
}

export interface StaffWorkExperience {
  id: string
  staffId: string
  employer: string
  role: string | null
  startDate: string | null
  endDate: string | null
}

export type ChildRecord = StaffContact | StaffQualification | StaffDependent | StaffWorkExperience

export async function listChildRecords<T = ChildRecord>(staffId: string, resource: ChildResource) {
  const res = await api.get<T[]>(`/api/staff/${staffId}/${resource}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function addChildRecord(
  staffId: string,
  resource: ChildResource,
  data: Record<string, unknown>
) {
  return api.post(`/api/staff/${staffId}/${resource}`, data)
}

export async function updateChildRecord(
  resource: ChildResource,
  id: string,
  data: Record<string, unknown>
) {
  return api.patch(`/api/staff/${resource}/${id}`, data)
}

export async function removeChildRecord(resource: ChildResource, id: string) {
  return api.delete(`/api/staff/${resource}/${id}`)
}
