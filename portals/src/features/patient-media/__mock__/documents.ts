// TODO(backend-wiring): replace with api.get('/api/patient-media/documents/patient/:patientId')
// Shape mirrors the eventual API response for a `patient_documents` table
// joined with the `document_tags` many-to-many relation.

export interface MockPatientDocument {
  id: string
  patientId: string
  title: string
  fileName: string
  /** Placeholder URL for the "View" action — opens in a new tab. */
  fileUrl: string
  sizeBytes: number
  /** References ids from MOCK_DOCUMENT_TAGS. */
  tagIds: string[]
  uploadedBy: string
  /** ISO-8601 upload timestamp. */
  uploadedAt: string
}

const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

export const MOCK_PATIENT_DOCUMENTS: MockPatientDocument[] = [
  {
    id: 'doc_001',
    patientId: 'mock-patient',
    title: 'Panoramic X-ray (Pre-op)',
    fileName: 'panoramic-2025-09.jpg',
    fileUrl: 'https://placehold.co/1200x800/png?text=Panoramic+X-ray',
    sizeBytes: 2_202_009,
    tagIds: ['tag_xray'],
    uploadedBy: 'Dr. Mensah',
    uploadedAt: daysAgo(2),
  },
  {
    id: 'doc_002',
    patientId: 'mock-patient',
    title: 'Insurance Card — Front & Back',
    fileName: 'insurance-card.pdf',
    fileUrl: 'https://placehold.co/1200x800/png?text=Insurance+Card',
    sizeBytes: 348_160,
    tagIds: ['tag_insurance'],
    uploadedBy: 'Reception',
    uploadedAt: daysAgo(8),
  },
  {
    id: 'doc_003',
    patientId: 'mock-patient',
    title: 'Orthodontic Consent Form',
    fileName: 'ortho-consent-signed.pdf',
    fileUrl: 'https://placehold.co/1200x800/png?text=Consent+Form',
    sizeBytes: 512_000,
    tagIds: ['tag_consent', 'tag_other'],
    uploadedBy: 'Dr. Boateng',
    uploadedAt: daysAgo(14),
  },
  {
    id: 'doc_004',
    patientId: 'mock-patient',
    title: 'Blood Work Lab Report',
    fileName: 'lab-results-cbc.pdf',
    fileUrl: 'https://placehold.co/1200x800/png?text=Lab+Results',
    sizeBytes: 1_048_576,
    tagIds: ['tag_lab_result'],
    uploadedBy: 'Dr. Mensah',
    uploadedAt: daysAgo(21),
  },
  {
    id: 'doc_005',
    patientId: 'mock-patient',
    title: 'Specialist Referral — Oral Surgery',
    fileName: 'referral-oral-surgery.docx',
    fileUrl: 'https://placehold.co/1200x800/png?text=Referral+Letter',
    sizeBytes: 76_800,
    tagIds: ['tag_referral'],
    uploadedBy: 'Dr. Mensah',
    uploadedAt: daysAgo(30),
  },
  {
    id: 'doc_006',
    patientId: 'mock-patient',
    title: 'Amoxicillin Prescription',
    fileName: 'rx-amoxicillin.pdf',
    fileUrl: 'https://placehold.co/1200x800/png?text=Prescription',
    sizeBytes: 124_928,
    tagIds: ['tag_prescription'],
    uploadedBy: 'Dr. Boateng',
    uploadedAt: daysAgo(45),
  },
  {
    id: 'doc_007',
    patientId: 'mock-patient',
    title: 'Bitewing X-rays (Left Quadrant)',
    fileName: 'bitewing-left.jpg',
    fileUrl: 'https://placehold.co/1200x800/png?text=Bitewing+X-rays',
    sizeBytes: 1_572_864,
    tagIds: ['tag_xray', 'tag_lab_result'],
    uploadedBy: 'Dr. Mensah',
    uploadedAt: daysAgo(60),
  },
]
