import { api } from '@/lib/api-client'

export interface ComplianceDocument {
  id: string
  documentName: string
  // Stores the chosen category's name. Live categories come from the
  // compliance-categories CRUD (Settings); COMPLIANCE_CATEGORIES is the fallback.
  category: string
  documentUrl?: string | null
  dateIssued?: string | null
  dateExpired?: string | null
  reminderEnabled: boolean
  reminderMonthsBefore?: number | null
  reminderPhones?: string[]
  reminderMessage?: string | null
  issuingAuthority?: string | null
  notes?: string | null
  lastReminderSentAt?: string | null
  createdAt: string
  updatedAt: string
  renewals?: ComplianceDocumentRenewal[]
}

export interface ComplianceDocumentRenewal {
  id: string
  documentId: string
  documentUrl: string
  receiptUrl?: string | null
  amountPaid?: string | number | null
  expiryDate: string
  notes?: string | null
  uploadedById?: string | null
  uploadedAt: string
}

export const COMPLIANCE_CATEGORIES = [
  { value: 'health', label: 'Health' },
  { value: 'finance', label: 'Finance' },
  { value: 'operations', label: 'Operations' },
  { value: 'data', label: 'Data & Privacy' },
  { value: 'fire', label: 'Fire & Safety' },
] as const

export async function getComplianceDocuments() {
  return api.get<ComplianceDocument[]>('/api/compliance')
}

export async function createComplianceDocument(
  data: Omit<ComplianceDocument, 'id' | 'createdAt' | 'updatedAt'>
) {
  return api.post<ComplianceDocument>('/api/compliance', data)
}

export async function updateComplianceDocument(id: string, data: Partial<ComplianceDocument>) {
  return api.patch<ComplianceDocument>(`/api/compliance/${id}`, data)
}

export async function deleteComplianceDocument(id: string) {
  return api.delete(`/api/compliance/${id}`)
}

export async function getComplianceDocument(id: string) {
  return api.get<ComplianceDocument>(`/api/compliance/${id}`)
}

export async function createComplianceDocumentRenewal(
  documentId: string,
  data: Omit<ComplianceDocumentRenewal, 'id' | 'documentId' | 'uploadedById' | 'uploadedAt'>
) {
  return api.post<ComplianceDocumentRenewal>(`/api/compliance/${documentId}/renewals`, data)
}
