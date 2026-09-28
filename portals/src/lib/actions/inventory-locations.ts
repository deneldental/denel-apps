import { api } from '@/lib/api-client'

export type InventoryLocation = {
  id: string
  name: string
  code: string
  description: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export async function getInventoryLocations() {
  return api.get<InventoryLocation[]>('/api/inventory-locations')
}

export async function createInventoryLocation(data: {
  name: string
  code: string
  description?: string | null
}) {
  return api.post<InventoryLocation>('/api/inventory-locations', data)
}

export async function updateInventoryLocation(
  id: string,
  data: Partial<{ name: string; code: string; description: string | null; isActive: boolean }>
) {
  return api.patch<InventoryLocation>(`/api/inventory-locations/${id}`, data)
}

export async function deleteInventoryLocation(id: string) {
  return api.delete<void>(`/api/inventory-locations/${id}`)
}
