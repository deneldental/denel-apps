import { api } from '@/lib/api-client'

export interface SupplierDocument {
  id: string
  supplierId: string
  title: string
  fileName: string
  fileUrl: string
  fileKey: string | null
  sizeBytes: number
  createdAt: string
  updatedAt: string
}

export function getSupplierDocuments(supplierId: string) {
  return api.get<SupplierDocument[]>(`/api/suppliers/${supplierId}/documents`)
}

export function createSupplierDocument(
  supplierId: string,
  data: { title: string; fileName: string; fileUrl: string; fileKey?: string; sizeBytes?: number }
) {
  return api.post<SupplierDocument>(`/api/suppliers/${supplierId}/documents`, data)
}

export function deleteSupplierDocument(supplierId: string, docId: string) {
  return api.delete<void>(`/api/suppliers/${supplierId}/documents/${docId}`)
}
