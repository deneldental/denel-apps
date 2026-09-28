import { api } from '@/lib/api-client'

export type ConsentTemplate = {
  id: string
  name: string
  type: string
  description: string | null
  pdfUrl: string | null
  pdfKey: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export async function getConsentTemplates() {
  return api.get<ConsentTemplate[]>('/api/consent-templates')
}

export async function createConsentTemplate(data: {
  name: string
  type?: string
  description?: string | null
  pdfUrl?: string | null
  pdfKey?: string | null
}) {
  return api.post<ConsentTemplate>('/api/consent-templates', data)
}

export async function updateConsentTemplate(
  id: string,
  data: Partial<{
    name: string
    type: string
    description: string | null
    pdfUrl: string | null
    pdfKey: string | null
    isActive: boolean
  }>
) {
  return api.patch<ConsentTemplate>(`/api/consent-templates/${id}`, data)
}

export async function deleteConsentTemplate(id: string) {
  return api.delete<void>(`/api/consent-templates/${id}`)
}
