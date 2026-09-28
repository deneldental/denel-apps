import { api } from '@/lib/api-client'

// Document signing engine client (admin-v1 CC.4). Portal-authed (compliance).

export interface TemplateField {
  id: string
  page: number
  x: number
  y: number
  w: number
  h: number
  type: 'text' | 'name' | 'address' | 'date' | 'signature' | 'initials' | 'checkbox'
  binding?: string
  signerRole?: string
}

export interface DocTemplate {
  id: string
  name: string
  category: string
  description: string | null
  pdfUrl: string
  fields: TemplateField[]
  isActive: boolean
  createdAt: string
}
export interface DocInstance {
  id: string
  templateId: string | null
  title: string
  subjectType: string
  subjectId: string
  mode: 'digital' | 'uploaded'
  status: 'draft' | 'completed'
  signedPdfUrl: string | null
  contentHash: string | null
  completedAt: string | null
  createdAt: string
}

export function createDocTemplate(body: {
  name: string
  category: string
  description?: string | null
  pdfUrl: string
  fields?: TemplateField[]
}) {
  return api.post<DocTemplate>('/api/documents/templates', body)
}
export function updateDocTemplate(
  id: string,
  body: Partial<{
    name: string
    description: string | null
    fields: TemplateField[]
    isActive: boolean
  }>
) {
  return api.patch<DocTemplate>(`/api/documents/templates/${id}`, body)
}
export function getDocTemplates(category?: string) {
  return api.get<DocTemplate[]>(
    `/api/documents/templates${category ? `?category=${encodeURIComponent(category)}` : ''}`
  )
}
export function getSubjectDocuments(subjectType: string, subjectId: string) {
  return api.get<DocInstance[]>(
    `/api/documents/instances?subjectType=${subjectType}&subjectId=${encodeURIComponent(subjectId)}`
  )
}
export function createDocInstance(body: {
  templateId: string
  subjectType: string
  subjectId: string
  title?: string
  signingOrder?: 'SEQUENTIAL' | 'PARALLEL'
  signers?: Array<{ role: string; name: string; email: string; order?: number }>
}) {
  return api.post<
    DocInstance & {
      signers?: Array<{
        id: string
        name: string
        email: string
        order: number
        status: string
        magicLink: string
      }>
    }
  >('/api/documents/instances', body)
}
export function signDocument(
  id: string,
  values: Record<string, string>,
  signers?: Array<{ role: string; name: string }>
) {
  return api.post<DocInstance>(`/api/documents/instances/${id}/sign`, { values, signers })
}
export function uploadSignedDocument(form: FormData) {
  return api.post<DocInstance>('/api/documents/instances/upload', form)
}
