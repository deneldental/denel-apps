import { api } from '@/lib/api-client'
import type { products } from '@/lib/db/schema'

export async function getProducts() {
  return api.get<any[]>('/api/products')
}

export async function getProduct(id: string) {
  return api.get<any>(`/api/products/${id}`)
}

export async function createProduct(data: typeof products.$inferInsert) {
  const res = await api.post<any>('/api/products', data)
  return res
}

export async function updateProduct(id: string, data: Partial<typeof products.$inferInsert>) {
  const res = await api.patch<any>(`/api/products/${id}`, data)
  if (res.success) {
  }
  return res
}

export async function deleteProduct(id: string) {
  const res = await api.delete<any>(`/api/products/${id}`)
  return res
}
