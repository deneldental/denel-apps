// TODO(backend-wiring): replace with api.get('/api/treatment-plans')

export type TreatmentPlanStatus = 'proposed' | 'accepted' | 'in_progress' | 'completed' | 'declined'

export type LineItemStatus = 'proposed' | 'accepted' | 'planned' | 'done' | 'declined' | 'deferred'

export interface MockTreatmentPlanLineItem {
  id: string
  treatmentTypeId: string
  treatmentName: string // denormalized for display
  toothNumbers: number[] | null // FDI notation
  amount: number
  status: LineItemStatus
}

export interface MockTreatmentPlanVisit {
  id: string
  order: number
  scheduledAt: string | null // ISO; null = TBD
  durationMinutes: number
  lineItems: MockTreatmentPlanLineItem[]
}

export interface MockTreatmentPlan {
  id: string
  patientId: string
  patientName: string // denormalized
  name: string
  status: TreatmentPlanStatus
  visits: MockTreatmentPlanVisit[]
  narrative: string | null
  consentSignedAt: string | null
  consentSignatureUrl: string | null // mock placeholder
  estimatedTotal: number // sum of all line items
  acceptedTotal: number // sum of accepted/done/planned
  completedTotal: number // sum of done
  createdBy: string
  createdAt: string
  updatedAt: string
}

// ─── Helpers (internal) ───────────────────────────────────────────────────────

function sumLineItems(
  visits: MockTreatmentPlanVisit[],
  predicate: (s: LineItemStatus) => boolean
): number {
  return visits.reduce(
    (total, visit) =>
      total + visit.lineItems.reduce((vt, li) => vt + (predicate(li.status) ? li.amount : 0), 0),
    0
  )
}

function buildPlan(
  plan: Omit<MockTreatmentPlan, 'estimatedTotal' | 'acceptedTotal' | 'completedTotal'>
): MockTreatmentPlan {
  return {
    ...plan,
    estimatedTotal: sumLineItems(plan.visits, () => true),
    acceptedTotal: sumLineItems(
      plan.visits,
      (s) => s === 'accepted' || s === 'planned' || s === 'done'
    ),
    completedTotal: sumLineItems(plan.visits, (s) => s === 'done'),
  }
}

// ─── Seed data ────────────────────────────────────────────────────────────────

export const MOCK_TREATMENT_PLANS: MockTreatmentPlan[] = [
  buildPlan({
    id: 'tp-001',
    patientId: '85007caf-bf47-466f-8a7f-e8464b9377c3',
    patientName: 'Henry Klevor',
    name: 'Preventive Care & Restorations',
    status: 'in_progress',
    visits: [
      {
        id: 'tp-001-v1',
        order: 1,
        scheduledAt: '2026-03-14T10:00:00.000Z',
        durationMinutes: 45,
        lineItems: [
          {
            id: 'tp-001-v1-i1',
            treatmentTypeId: 'tt-scaling',
            treatmentName: 'Scaling & Polishing',
            toothNumbers: null,
            amount: 300,
            status: 'done',
          },
          {
            id: 'tp-001-v1-i2',
            treatmentTypeId: 'tt-fluoride',
            treatmentName: 'Fluoride Application',
            toothNumbers: null,
            amount: 150,
            status: 'done',
          },
        ],
      },
      {
        id: 'tp-001-v2',
        order: 2,
        scheduledAt: '2026-04-18T11:30:00.000Z',
        durationMinutes: 60,
        lineItems: [
          {
            id: 'tp-001-v2-i1',
            treatmentTypeId: 'tt-composite',
            treatmentName: 'Composite Filling',
            toothNumbers: [16],
            amount: 500,
            status: 'planned',
          },
          {
            id: 'tp-001-v2-i2',
            treatmentTypeId: 'tt-xray',
            treatmentName: 'X-ray (Bitewing)',
            toothNumbers: null,
            amount: 200,
            status: 'planned',
          },
        ],
      },
    ],
    narrative:
      'Patient presented with generalised calculus and one carious lesion on #16. Plan focuses on stabilisation and recall.',
    consentSignedAt: '2026-03-10T09:12:00.000Z',
    consentSignatureUrl: 'mock://signatures/tp-001.png',
    createdBy: 'Dr. Ama Mensah',
    createdAt: '2026-03-09T15:22:00.000Z',
    updatedAt: '2026-03-14T10:45:00.000Z',
  }),

  buildPlan({
    id: 'tp-002',
    patientId: 'pt-aisha-boateng',
    patientName: 'Aisha Boateng',
    name: 'Endodontic & Crown — Upper Left Molar',
    status: 'accepted',
    visits: [
      {
        id: 'tp-002-v1',
        order: 1,
        scheduledAt: '2026-04-22T09:00:00.000Z',
        durationMinutes: 90,
        lineItems: [
          {
            id: 'tp-002-v1-i1',
            treatmentTypeId: 'tt-rct',
            treatmentName: 'Root Canal Treatment',
            toothNumbers: [26],
            amount: 2500,
            status: 'accepted',
          },
          {
            id: 'tp-002-v1-i2',
            treatmentTypeId: 'tt-xray-pa',
            treatmentName: 'X-ray (Periapical)',
            toothNumbers: [26],
            amount: 200,
            status: 'accepted',
          },
        ],
      },
      {
        id: 'tp-002-v2',
        order: 2,
        scheduledAt: '2026-05-06T09:00:00.000Z',
        durationMinutes: 60,
        lineItems: [
          {
            id: 'tp-002-v2-i1',
            treatmentTypeId: 'tt-crown-prep',
            treatmentName: 'Crown Preparation & Impression',
            toothNumbers: [26],
            amount: 1800,
            status: 'accepted',
          },
        ],
      },
      {
        id: 'tp-002-v3',
        order: 3,
        scheduledAt: null,
        durationMinutes: 45,
        lineItems: [
          {
            id: 'tp-002-v3-i1',
            treatmentTypeId: 'tt-crown-fit',
            treatmentName: 'Crown Cementation',
            toothNumbers: [26],
            amount: 1200,
            status: 'accepted',
          },
        ],
      },
    ],
    narrative:
      'Irreversible pulpitis on #26. RCT in one visit, followed by porcelain-fused-to-metal crown across two appointments.',
    consentSignedAt: '2026-04-15T12:00:00.000Z',
    consentSignatureUrl: 'mock://signatures/tp-002.png',
    createdBy: 'Dr. Kwame Owusu',
    createdAt: '2026-04-14T16:40:00.000Z',
    updatedAt: '2026-04-15T12:02:00.000Z',
  }),

  buildPlan({
    id: 'tp-003',
    patientId: 'pt-nii-tetteh',
    patientName: 'Nii Tetteh',
    name: 'Full-Mouth Rehabilitation',
    status: 'proposed',
    visits: [
      {
        id: 'tp-003-v1',
        order: 1,
        scheduledAt: null,
        durationMinutes: 60,
        lineItems: [
          {
            id: 'tp-003-v1-i1',
            treatmentTypeId: 'tt-scaling',
            treatmentName: 'Scaling & Polishing',
            toothNumbers: null,
            amount: 300,
            status: 'proposed',
          },
          {
            id: 'tp-003-v1-i2',
            treatmentTypeId: 'tt-opg',
            treatmentName: 'X-ray (OPG)',
            toothNumbers: null,
            amount: 450,
            status: 'proposed',
          },
        ],
      },
      {
        id: 'tp-003-v2',
        order: 2,
        scheduledAt: null,
        durationMinutes: 75,
        lineItems: [
          {
            id: 'tp-003-v2-i1',
            treatmentTypeId: 'tt-extraction',
            treatmentName: 'Simple Extraction',
            toothNumbers: [48],
            amount: 600,
            status: 'proposed',
          },
          {
            id: 'tp-003-v2-i2',
            treatmentTypeId: 'tt-composite',
            treatmentName: 'Composite Filling',
            toothNumbers: [36, 37],
            amount: 1000,
            status: 'proposed',
          },
        ],
      },
      {
        id: 'tp-003-v3',
        order: 3,
        scheduledAt: null,
        durationMinutes: 90,
        lineItems: [
          {
            id: 'tp-003-v3-i1',
            treatmentTypeId: 'tt-rct',
            treatmentName: 'Root Canal Treatment',
            toothNumbers: [14],
            amount: 2500,
            status: 'proposed',
          },
        ],
      },
      {
        id: 'tp-003-v4',
        order: 4,
        scheduledAt: null,
        durationMinutes: 60,
        lineItems: [
          {
            id: 'tp-003-v4-i1',
            treatmentTypeId: 'tt-bonding',
            treatmentName: 'Composite Bonding (Aesthetic)',
            toothNumbers: [11, 21],
            amount: 1600,
            status: 'proposed',
          },
          {
            id: 'tp-003-v4-i2',
            treatmentTypeId: 'tt-whitening',
            treatmentName: 'In-office Whitening',
            toothNumbers: null,
            amount: 1200,
            status: 'proposed',
          },
        ],
      },
    ],
    narrative:
      'Comprehensive rehab plan — patient wants aesthetic improvement in addition to restorative needs. Pending financial discussion.',
    consentSignedAt: null,
    consentSignatureUrl: null,
    createdBy: 'Dr. Ama Mensah',
    createdAt: '2026-04-05T14:05:00.000Z',
    updatedAt: '2026-04-05T14:05:00.000Z',
  }),

  buildPlan({
    id: 'tp-004',
    patientId: 'pt-efua-asante',
    patientName: 'Efua Asante',
    name: 'Cleaning & Recall',
    status: 'completed',
    visits: [
      {
        id: 'tp-004-v1',
        order: 1,
        scheduledAt: '2026-02-12T08:30:00.000Z',
        durationMinutes: 30,
        lineItems: [
          {
            id: 'tp-004-v1-i1',
            treatmentTypeId: 'tt-scaling',
            treatmentName: 'Scaling & Polishing',
            toothNumbers: null,
            amount: 300,
            status: 'done',
          },
        ],
      },
      {
        id: 'tp-004-v2',
        order: 2,
        scheduledAt: '2026-03-12T08:30:00.000Z',
        durationMinutes: 20,
        lineItems: [
          {
            id: 'tp-004-v2-i1',
            treatmentTypeId: 'tt-recall',
            treatmentName: 'Recall Examination',
            toothNumbers: null,
            amount: 150,
            status: 'done',
          },
        ],
      },
    ],
    narrative: 'Straightforward recall & cleaning cycle. No active issues.',
    consentSignedAt: '2026-02-10T11:00:00.000Z',
    consentSignatureUrl: 'mock://signatures/tp-004.png',
    createdBy: 'Dr. Kwame Owusu',
    createdAt: '2026-02-08T10:10:00.000Z',
    updatedAt: '2026-03-12T09:15:00.000Z',
  }),

  buildPlan({
    id: 'tp-005',
    patientId: 'pt-yaw-osei',
    patientName: 'Yaw Osei',
    name: 'Orthodontic Consult Follow-up',
    status: 'declined',
    visits: [
      {
        id: 'tp-005-v1',
        order: 1,
        scheduledAt: null,
        durationMinutes: 60,
        lineItems: [
          {
            id: 'tp-005-v1-i1',
            treatmentTypeId: 'tt-ortho-records',
            treatmentName: 'Orthodontic Records & Workup',
            toothNumbers: null,
            amount: 1500,
            status: 'declined',
          },
        ],
      },
      {
        id: 'tp-005-v2',
        order: 2,
        scheduledAt: null,
        durationMinutes: 90,
        lineItems: [
          {
            id: 'tp-005-v2-i1',
            treatmentTypeId: 'tt-ortho-fixed',
            treatmentName: 'Fixed Appliance Placement (Upper)',
            toothNumbers: null,
            amount: 8500,
            status: 'declined',
          },
          {
            id: 'tp-005-v2-i2',
            treatmentTypeId: 'tt-extraction',
            treatmentName: 'Extraction for Ortho (Premolars)',
            toothNumbers: [14, 24],
            amount: 1200,
            status: 'declined',
          },
        ],
      },
    ],
    narrative:
      'Patient declined due to cost. Left the door open for a phased approach in 6 months.',
    consentSignedAt: null,
    consentSignatureUrl: null,
    createdBy: 'Dr. Ama Mensah',
    createdAt: '2026-01-22T13:00:00.000Z',
    updatedAt: '2026-01-30T09:00:00.000Z',
  }),
]
