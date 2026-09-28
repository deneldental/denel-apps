import { api } from '@/lib/api-client'

const TYPE = 'expense-categories'

export async function getExpenseCategories() {
  return api.get<any[]>(`/api/lookups/${TYPE}`)
}

export async function getAllExpenseCategories() {
  return api.get<any[]>(`/api/lookups/${TYPE}/all`)
}

export async function createExpenseCategory(data: { name: string; displayName?: string }) {
  const res = await api.post<any>(`/api/lookups/${TYPE}`, data)
  return res
}

export async function toggleExpenseCategoryActive(id: string, isActive: boolean) {
  const res = await api.patch<any>(`/api/lookups/${TYPE}/${id}`, { isActive })
  return res
}

export async function updateExpenseCategory(
  id: string,
  data: { name: string; displayName?: string }
) {
  const res = await api.patch<any>(`/api/lookups/${TYPE}/${id}`, data)
  return res
}

export async function deleteExpenseCategory(id: string) {
  const res = await api.delete<any>(`/api/lookups/${TYPE}/${id}`)
  return res
}
