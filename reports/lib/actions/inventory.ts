import { api } from '@/lib/api-client'
import type { inventory } from '@/lib/db/schema'

export async function getInventoryItems() {
  const res = await api.get<any[]>('/api/inventory')
  return { success: res.success, data: res.data || [], error: res.error }
}

export async function getInventoryItem(id: string) {
  const res = await api.get<any>(`/api/inventory/${id}`)
  return res.data
}

export async function createInventoryItem(data: typeof inventory.$inferInsert) {
  const res = await api.post<any>('/api/inventory', data)
  return res
}

export async function updateInventoryItem(
  id: string,
  data: Partial<typeof inventory.$inferInsert>
) {
  const res = await api.patch<any>(`/api/inventory/${id}`, data)
  return res
}

export async function deleteInventoryItem(id: string) {
  const res = await api.delete<any>(`/api/inventory/${id}`)
  return res
}
