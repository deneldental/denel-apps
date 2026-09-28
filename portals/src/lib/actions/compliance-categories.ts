import { api } from '@/lib/api-client'

export type ComplianceCategory = {
  id: string
  name: string
  description: string | null
  color: string
  iconName: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export async function getComplianceCategories() {
  return api.get<ComplianceCategory[]>('/api/compliance-categories')
}

export async function createComplianceCategory(data: {
  name: string
  description?: string | null
  color?: string
  iconName?: string | null
}) {
  return api.post<ComplianceCategory>('/api/compliance-categories', data)
}

export async function updateComplianceCategory(
  id: string,
  data: Partial<{
    name: string
    description: string | null
    color: string
    iconName: string | null
    isActive: boolean
  }>
) {
  return api.patch<ComplianceCategory>(`/api/compliance-categories/${id}`, data)
}

export async function deleteComplianceCategory(id: string) {
  return api.delete<void>(`/api/compliance-categories/${id}`)
}
