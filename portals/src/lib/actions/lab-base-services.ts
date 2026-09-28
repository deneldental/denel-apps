import { api } from '@/lib/api-client'

export type LabUnitType = 'per_tooth' | 'per_arch' | 'per_case'

export interface LabServiceCategory {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface LabScope {
  id: string
  name: string
  displayName: string
  quantityMode: 'single' | 'multi'
}

export interface LabBaseService {
  id: string
  name: string
  categoryId: string | null
  /** Application type (0171) — replaces unitType. */
  scopeId: string | null
  unitType: LabUnitType
  standardTurnaroundDays: number | null
  notes: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  category?: LabServiceCategory | null
  scope?: LabScope | null
}

// ── Categories ───────────────────────────────────────────────────────────────

export async function getLabCategories() {
  const res = await api.get<LabServiceCategory[]>('/api/labs/categories')
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function createLabCategory(data: { name: string; isActive?: boolean }) {
  return api.post<LabServiceCategory>('/api/labs/categories', data)
}

export async function updateLabCategory(id: string, data: Partial<LabServiceCategory>) {
  return api.patch<LabServiceCategory>(`/api/labs/categories/${id}`, data)
}

export async function deleteLabCategory(id: string) {
  return api.delete<void>(`/api/labs/categories/${id}`)
}

// ── Base services ────────────────────────────────────────────────────────────

export async function getLabBaseServices() {
  const res = await api.get<LabBaseService[]>('/api/labs/base-services')
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function createLabBaseService(data: {
  name: string
  categoryId?: string | null
  scopeId?: string | null
  unitType?: LabUnitType
  standardTurnaroundDays?: number
  notes?: string | null
  isActive?: boolean
}) {
  return api.post<LabBaseService>('/api/labs/base-services', data)
}

export async function updateLabBaseService(id: string, data: Partial<LabBaseService>) {
  return api.patch<LabBaseService>(`/api/labs/base-services/${id}`, data)
}

export async function deleteLabBaseService(id: string) {
  return api.delete<void>(`/api/labs/base-services/${id}`)
}

export const UNIT_TYPE_LABELS: Record<LabUnitType, string> = {
  per_case: 'Per case',
  per_tooth: 'Per tooth',
  per_arch: 'Per arch',
}
