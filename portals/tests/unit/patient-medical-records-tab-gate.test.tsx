/**
 * Pins the fix for the Medium finding "The Medical Records tab has a dead
 * permission gate" (project-docs/patient-records-and-scheduling-audit.md):
 * `canViewMedicalRecords` was computed and threaded down but never actually
 * read anywhere in `patient-detail-content.tsx` — the tab rendered
 * unconditionally for anyone who could open the Patient Detail page at all.
 */
import { act, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PatientDetailContent } from '@/features/patients/components/patient-detail-content'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi
      .fn()
      .mockResolvedValue({ success: true, data: { outstandingBalance: 0, paymentPlans: [] } }),
    post: vi.fn(),
  },
}))

vi.mock('@/features/patients/components/patient-timeline-tab', () => ({
  PatientTimelineTab: () => null,
}))
vi.mock('@/features/patient-cases/components/medical-records-sub-tabs', () => ({
  MedicalRecordsSubTabs: () => <div>Medical records content</div>,
}))
vi.mock('@/features/patient-media/components/documents-tab', () => ({ DocumentsTab: () => null }))
vi.mock('@/features/patients/components/patient-ledger-tab', () => ({
  PatientLedgerTab: () => null,
}))
vi.mock('@/features/patients/components/statements-tab', () => ({ StatementsTab: () => null }))
vi.mock('@/features/patients/components/pwa-access-tab', () => ({ PwaAccessTab: () => null }))
vi.mock('@/features/patients/components/edit-patient-sheet', () => ({
  EditPatientSheet: () => null,
}))
vi.mock('@/features/audit-logs/components/view-audit-history-link', () => ({
  ViewAuditHistoryLink: () => null,
}))

afterEach(() => vi.clearAllMocks())

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })

function patient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    name: 'Ama Mensah',
    patientId: 'FD-2609-0001',
    phone: '+233201234567',
    email: null,
    address: null,
    dob: '1990-01-01',
    gender: 'female',
    nationality: null,
    occupation: null,
    profileImage: null,
    isChild: false,
    guardianName: null,
    guardianPhone: null,
    guardianOccupation: null,
    guardianAddress: null,
    insuranceProvider: null,
    insurancePolicyNumber: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    pwaAccessEnabled: false,
    createdAt: '2026-01-01T00:00:00Z',
    tags: [],
    ...overrides,
  } as never
}

describe('Patient Detail — Medical Records tab permission gate', () => {
  it('hides the Medical Records tab when canViewMedicalRecords is false', async () => {
    renderWithRouter(<PatientDetailContent patient={patient()} canViewMedicalRecords={false} />)
    await settle()
    expect(screen.queryByText('Medical Records')).not.toBeInTheDocument()
  })

  it('shows the Medical Records tab and its content when canViewMedicalRecords is true', async () => {
    renderWithRouter(
      <PatientDetailContent patient={patient()} canViewMedicalRecords={true} isDoctor={true} />
    )
    await settle()
    expect(screen.getByText('Medical Records')).toBeInTheDocument()
    // isDoctor defaults activeTab to 'medical', so its content mounts immediately.
    expect(screen.getByText('Medical records content')).toBeInTheDocument()
  })
})
