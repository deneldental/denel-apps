/**
 * The patient detail page under a background refetch. Editing a patient
 * invalidates the query cache and the parent re-renders with fresh data, but
 * `PatientDetailContent` used to freeze its own `patient` state on first
 * mount and never adopt the new prop — so the bio pane, breadcrumb, and every
 * child tab kept showing pre-edit data until a full page reload.
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

// Trivial stubs — this test is isolated to PatientDetailContent's own prop
// handling, not its children's data fetching. Only the default-active
// "timeline" tab actually mounts (Radix Tabs unmounts inactive content), but
// stub every tab for safety against that changing.
vi.mock('@/features/patients/components/patient-timeline-tab', () => ({
  PatientTimelineTab: () => null,
}))
vi.mock('@/features/patient-cases/components/medical-records-sub-tabs', () => ({
  MedicalRecordsSubTabs: () => null,
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

/** Let the component's own `/summary` fetch effect settle (unrelated to the
 *  bug under test, but its post-mount `.then()` update needs flushing so
 *  React Testing Library doesn't warn about an unwrapped act()). */
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

describe('Patient detail page after a background refetch', () => {
  it('shows the edited patient once the parent re-renders with fresh data', async () => {
    // The name renders twice (breadcrumb + bio pane), so this pins both
    // spots at once rather than picking one arbitrarily.
    const { rerender } = renderWithRouter(<PatientDetailContent patient={patient()} />)
    await settle()
    expect(screen.getAllByText('Ama Mensah')).toHaveLength(2)

    rerender(
      <PatientDetailContent patient={patient({ name: 'Ama Owusu', phone: '+233209999999' })} />
    )
    await settle()

    expect(screen.getAllByText('Ama Owusu')).toHaveLength(2)
    expect(screen.queryByText('Ama Mensah')).not.toBeInTheDocument()
    expect(screen.getByText('+233209999999')).toBeInTheDocument()
  })
})
