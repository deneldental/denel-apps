import { api } from '@/lib/api-client'
import type { expenses } from '@/lib/db/schema'

export async function getExpenses() {
  const res = await api.get<any[]>('/api/expenses')
  return { success: res.success, data: res.data || [], error: res.error }
}

export async function createExpense(data: typeof expenses.$inferInsert) {
  const res = await api.post<any>('/api/expenses', data)
  return res
}

export async function updateExpense(id: string, data: Partial<typeof expenses.$inferInsert>) {
  const res = await api.patch<any>(`/api/expenses/${id}`, data)
  return res
}

export async function deleteExpense(id: string) {
  const res = await api.delete<any>(`/api/expenses/${id}`)
  return res
}

export async function getExpense(id: string) {
  return api.get<any>(`/api/expenses/${id}`)
}

export async function createExpenseYear(data: { year: number; activeMonths: string[] }) {
  const res = await api.post<{ id: string; year: number; activeMonths: string[] }>(
    '/api/expenses/years',
    data
  )
  return res
}
