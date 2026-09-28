import { api } from '@/lib/api-client'

export async function getXrayTypes() {
  return api.get<any[]>('/api/xrays/types')
}

export async function createXrayType(data: {
  name: string
  displayName: string
  description?: string
}) {
  return api.post<any>('/api/xrays/types', data)
}

export async function updateXrayType(
  id: string,
  data: { name?: string; displayName?: string; description?: string; active?: boolean }
) {
  return api.patch<any>(`/api/xrays/types/${id}`, data)
}

export async function deleteXrayType(id: string) {
  return api.delete<any>(`/api/xrays/types/${id}`)
}
