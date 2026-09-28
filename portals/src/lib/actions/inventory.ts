import { api } from '@/lib/api-client'
import type { items } from '@/lib/db/schema'

export type InventoryBatch = {
  id: string
  itemId: string
  itemName: string
  locationId: string | null
  locationName: string | null
  qtyRemaining: number
  unitCost: number | null
  expiryDate: string | null
  lotNumber: string | null
  createdAt: string
}

export async function getInventoryItems(params?: {
  limit?: number
  offset?: number
  search?: string
}) {
  const qs = new URLSearchParams()
  if (params?.limit !== undefined) qs.set('limit', String(params.limit))
  if (params?.offset !== undefined) qs.set('offset', String(params.offset))
  if (params?.search) qs.set('search', params.search)
  const query = qs.toString()
  const res = await api.get<{ data: any[]; total: number } | any[]>(
    `/api/inventory${query ? `?${query}` : ''}`
  )
  if (!res.success) return { success: false as const, data: [], total: 0, error: res.error }
  // Handle both old (array) and new (paginated) response shapes
  if (Array.isArray(res.data)) {
    return { success: true as const, data: res.data, total: res.data.length, error: undefined }
  }
  const paged = res.data as { data: any[]; total: number }
  return {
    success: true as const,
    data: paged.data ?? [],
    total: paged.total ?? 0,
    error: undefined,
  }
}

export async function getInventoryBatches(params?: {
  itemId?: string
  expiringDays?: number
  limit?: number
  offset?: number
}): Promise<{ data: InventoryBatch[]; total: number }> {
  const qs = new URLSearchParams()
  if (params?.itemId) qs.set('itemId', params.itemId)
  if (params?.expiringDays !== undefined) qs.set('expiringDays', String(params.expiringDays))
  if (params?.limit !== undefined) qs.set('limit', String(params.limit))
  if (params?.offset !== undefined) qs.set('offset', String(params.offset))
  const query = qs.toString()
  const res = await api.get<{ data: InventoryBatch[]; total: number }>(
    `/api/inventory/batches${query ? `?${query}` : ''}`
  )
  if (!res.success || !res.data) return { data: [], total: 0 }
  return { data: res.data.data ?? [], total: res.data.total ?? 0 }
}

export async function receiveInventory(data: {
  lines: Array<{
    itemId: string
    qty: number
    unitCost: number
    locationId?: string | null
    expiryDate?: string | null
    lotNumber?: string | null
  }>
  supplierId?: string | null
  notes?: string | null
  paidNow: boolean
  paymentMethod?: string | null
  receiptUrl?: string | null
}): Promise<{ receiptId: string }> {
  const res = await api.post<{ receiptId: string }>('/api/inventory/receive', data)
  if (!res.success || !res.data) {
    throw new Error(res.error || 'Failed to receive inventory')
  }
  return res.data
}

export async function transferInventoryStock(
  itemId: string,
  body: { fromLocationId: string; toLocationId: string; qty: number }
): Promise<void> {
  const res = await api.post<unknown>(`/api/inventory/${itemId}/transfer`, body)
  if (!res.success) {
    throw new Error(res.error || 'Failed to transfer stock')
  }
}

export async function getInventoryItem(id: string) {
  const res = await api.get<any>(`/api/inventory/${id}`)
  return { success: res.success, data: res.data, error: res.error }
}

export async function createInventoryItem(data: typeof items.$inferInsert) {
  const res = await api.post<any>('/api/inventory', data)
  return res
}

export async function updateInventoryItem(id: string, data: Partial<typeof items.$inferInsert>) {
  const res = await api.patch<any>(`/api/inventory/${id}`, data)
  return res
}

export async function deleteInventoryItem(id: string) {
  const res = await api.delete<any>(`/api/inventory/${id}`)
  return res
}

// ── settings-domain-audit S5-B: reasoned adjustments + valuation ─────────────

export interface AdjustStockBody {
  /** `set` = the new physical count; `delta` = signed change. */
  mode: 'set' | 'delta'
  quantity: number
  reason: string
  note?: string
  locationId?: string | null
}

export async function adjustInventoryStock(
  itemId: string,
  body: AdjustStockBody
): Promise<{ stockQuantity: number; delta: number }> {
  const res = await api.post<{ stockQuantity: number; delta: number }>(
    `/api/inventory/${itemId}/adjust`,
    body
  )
  if (!res.success || !res.data) {
    throw new Error(res.error || 'Failed to adjust stock')
  }
  return res.data
}

export interface InventoryValuation {
  method: 'fifo' | 'weighted_average'
  /** Pesewas. */
  totalValue: number
  itemCount: number
}

export function getInventoryValuation() {
  return api.get<InventoryValuation>('/api/inventory/valuation')
}
