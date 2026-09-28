export interface XrayType {
  id: string
  name: string
  displayName: string
  description: string | null
  active: boolean
}

export interface XrayRecord {
  id: string
  patientId: string
  xrayTypeId: string | null
  origin: 'internal' | 'external'
  toothNumber: number | null
  imageUrl: string
  thumbnailUrl: string | null
  capturedAt: string | null
  externalClinicName: string | null
  externalCapturedDate: string | null
  uploadedById: string | null
  uploadedAt: string
  notes: string | null
  type?: XrayType | null
}

export interface XrayShareLink {
  id: string
  linkToken: string
  accessCode: string
  xrayRecordIds: string[]
  patientId: string
  recipientName: string
  recipientContact: string | null
  createdById: string | null
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  accessCount: number
  verifiedAt: string | null
}

export interface ShareCreateResponse {
  id: string
  shareUrl: string
  accessCode: string
  expiresAt: string
  preformattedMessage: string
}
