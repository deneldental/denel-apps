import { api } from '@/lib/api-client'

export type DocumentTag = {
  id: string
  name: string
  displayName: string
  color: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export async function getDocumentTags() {
  return api.get<DocumentTag[]>('/api/document-tags')
}

export async function createDocumentTag(data: {
  name: string
  displayName: string
  color?: string
}) {
  return api.post<DocumentTag>('/api/document-tags', data)
}

export async function updateDocumentTag(
  id: string,
  data: Partial<{ displayName: string; color: string; isActive: boolean }>
) {
  return api.patch<DocumentTag>(`/api/document-tags/${id}`, data)
}

export async function deleteDocumentTag(id: string) {
  return api.delete<void>(`/api/document-tags/${id}`)
}
