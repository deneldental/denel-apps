export type PhotoCategory = 'intraoral' | 'portrait' | 'before' | 'after'
export type DocumentCategory = 'insurance_card' | 'id' | 'consent' | 'other'

export interface PatientPhoto {
  id: string
  patientId: string
  category: PhotoCategory
  clinicalScope: boolean
  imageUrl: string
  thumbnailUrl: string | null
  capturedAt: string | null
  linkedRecordId: string | null
  notes: string | null
  uploadedById: string | null
  uploadedAt: string
}

export interface PatientDocument {
  id: string
  patientId: string
  category: DocumentCategory
  clinicalScope: boolean
  fileName: string
  fileUrl: string
  fileSize: number | null
  mimeType: string | null
  notes: string | null
  uploadedById: string | null
  uploadedAt: string
}

export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
  intraoral: 'Intraoral',
  portrait: 'Portrait',
  before: 'Before',
  after: 'After',
}

export const DOC_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  insurance_card: 'Insurance Card',
  id: 'ID',
  consent: 'Consent',
  other: 'Other',
}
