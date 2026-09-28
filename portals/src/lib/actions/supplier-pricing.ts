import { api } from '@/lib/api-client'

export interface SupplierPriceItem {
  id: string
  supplierId: string
  itemName: string
  unit: string
  unitPrice: number
  createdAt: string
  updatedAt: string
}

export function getSupplierPricing(supplierId: string) {
  return api.get<SupplierPriceItem[]>(`/api/suppliers/${supplierId}/pricing`)
}

export function createSupplierPriceItem(
  supplierId: string,
  data: { itemName: string; unit: string; unitPrice: number }
) {
  return api.post<SupplierPriceItem>(`/api/suppliers/${supplierId}/pricing`, data)
}

export function updateSupplierPriceItem(
  supplierId: string,
  itemId: string,
  data: Partial<{ itemName: string; unit: string; unitPrice: number }>
) {
  return api.patch<SupplierPriceItem>(`/api/suppliers/${supplierId}/pricing/${itemId}`, data)
}

export function deleteSupplierPriceItem(supplierId: string, itemId: string) {
  return api.delete<void>(`/api/suppliers/${supplierId}/pricing/${itemId}`)
}
