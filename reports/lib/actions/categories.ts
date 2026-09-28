import { api } from '@/lib/api-client'

const TYPE = 'categories'

export async function getCategories() {
  return api.get<any[]>(`/api/lookups/${TYPE}`)
}

export async function getAllCategories() {
  return api.get<any[]>(`/api/lookups/${TYPE}/all`)
}

export async function createCategory(data: { name: string; displayName?: string }) {
  const res = await api.post<any>(`/api/lookups/${TYPE}`, data)
  return res
}

export async function toggleCategoryActive(id: string, isActive: boolean) {
  const res = await api.patch<any>(`/api/lookups/${TYPE}/${id}`, { isActive })
  return res
}

export async function updateCategory(id: string, data: { name: string; displayName?: string }) {
  const res = await api.patch<any>(`/api/lookups/${TYPE}/${id}`, data)
  return res
}

export async function deleteCategory(id: string) {
  const res = await api.delete<any>(`/api/lookups/${TYPE}/${id}`)
  return res
}
