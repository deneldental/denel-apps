import { api } from '@/lib/api-client'

export type Supplier = {
  id: string
  name: string
  contactEmail: string | null
  contactPhone: string | null
  address: string | null
  paymentTerms: string | null
  notes: string | null
  active: boolean
  tin: string | null
  defaultPaymentTermsDays: number | null
  createdAt: string
  updatedAt: string
}

export async function listSuppliers() {
  const res = await api.get<Supplier[]>('/api/suppliers')
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function getSupplier(id: string) {
  return api.get<Supplier>(`/api/suppliers/${id}`)
}

export async function createSupplier(input: Partial<Supplier> & { name: string }) {
  return api.post<Supplier>('/api/suppliers', input)
}

export async function updateSupplier(id: string, input: Partial<Supplier>) {
  return api.patch<Supplier>(`/api/suppliers/${id}`, input)
}
