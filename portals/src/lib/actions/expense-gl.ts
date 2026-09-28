import { api } from '@/lib/api-client'

// Admin-v1 Phase 4 — expense ↔ GL bookkeeping (category buckets + pending-to-file).

export interface ExpenseGLCategory {
  id: string
  name: string
  displayName: string | null
  accountId: string | null
  isActive: boolean
}
export interface UnpostedExpense {
  id: string
  category: string
  amount: number
  date: string
  description: string | null
  paymentMethod: string | null
  accountId: string | null
}

export function getExpenseGLCategories() {
  return api.get<ExpenseGLCategory[]>('/api/expenses/categories')
}
export function mapExpenseCategoryAccount(id: string, accountId: string | null) {
  return api.put<{ id: string; accountId: string | null; filed?: number } & { filed?: number }>(
    `/api/expenses/categories/${id}/account`,
    { accountId }
  )
}
export function getUnpostedExpenses() {
  return api.get<UnpostedExpense[]>('/api/expenses/unposted')
}
export function fileExpense(id: string) {
  return api.post<{ glPosted: boolean; glReason?: string }>(`/api/expenses/${id}/post`, {})
}
