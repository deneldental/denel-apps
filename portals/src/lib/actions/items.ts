import { api } from '@/lib/api-client'

export interface CatalogItem {
  id: string
  name: string
  sku: string | null
  category: string | null
  unit: string | null
  stockQuantity: number
  reorderLevel: number | null
  price: number | string | null
  costPrice: number | string | null
  sellable: boolean
  consumable: boolean
  Prescription: boolean
  lab: boolean
  source: string | null
}

/** Read the unified item catalog (admin-v1 §12.1), optionally filtered by capability. */
export async function getItems(filters?: {
  q?: string
  sellable?: boolean
  consumable?: boolean
  Prescription?: boolean
  lab?: boolean
}) {
  const params = new URLSearchParams()
  if (filters?.q) params.set('q', filters.q)
  if (filters?.sellable) params.set('sellable', 'true')
  if (filters?.consumable) params.set('consumable', 'true')
  if (filters?.Prescription) params.set('Prescription', 'true')
  if (filters?.lab) params.set('lab', 'true')
  const qs = params.toString()
  const res = await api.get<CatalogItem[]>(`/api/items${qs ? `?${qs}` : ''}`)
  return { success: res.success, data: res.data || [], error: res.error }
}
