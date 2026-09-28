export interface InsuranceCompany {
  id: string
  name: string
  contactEmail: string | null
  contactPhone: string | null
  address: string | null
  notes: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface ReconciliationEntry {
  id: string
  companyId: string
  patientId: string
  cardNumber: string
  treatmentSourceType: 'medical_record' | 'invoice'
  treatmentSourceId: string
  chargedAmount: number
  insurerPaidAmount: number | null
  reconciledAt: string | null
  notes: string | null
  walletTransactionId: string | null
  recordedById: string | null
  recordedAt: string
  updatedAt: string
  patient?: { id: string; name: string; patientId: string | null }
  company?: { id: string; name: string }
}
