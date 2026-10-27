/**
 * Pins the fix for finding H5 (bullet 3)
 * (project-docs/patient-records-and-scheduling-audit.md): the row-menu "Edit"
 * item had no permission check at all (only "Archive"/"Delete" did), unlike
 * the equivalent button on the Patient Detail page which correctly checks
 * patients:update. It's now gated on `useCan('patients', 'update')`.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type PatientRow, PatientTable } from '@/features/patients/components/patient-table'
import { renderWithRouter } from './_test-utils'

vi.mock('@/features/patients/components/edit-patient-sheet', () => ({
  EditPatientSheet: () => null,
}))
vi.mock('@/features/patients/components/archive-confirmation-dialog', () => ({
  ArchiveConfirmationDialog: () => null,
}))
vi.mock('@/shared/components/ui/admin-password-dialog', () => ({
  AdminPasswordDialog: () => null,
}))
vi.mock('@/lib/actions/patients', () => ({
  archivePatient: vi.fn(),
  unarchivePatient: vi.fn(),
  permanentlyDeletePatient: vi.fn(),
}))
vi.mock('@/lib/permissions-context', () => ({ useCan: vi.fn() }))

import { useCan } from '@/lib/permissions-context'

const mockUseCan = vi.mocked(useCan)

function patient(): PatientRow {
  return {
    id: 'p-1',
    patientId: 'FD-2609-0001',
    name: 'Ama Mensah',
    phone: '+233201234567',
    gender: 'female',
    dob: new Date('1990-01-01'),
    isChild: false,
    nationality: 'Ghanaian',
    profileImage: null,
    guardianName: null,
    guardianPhone: null,
    guardianEmail: null,
    guardianAddress: null,
    email: null,
    address: null,
    occupation: null,
    createdAt: new Date('2026-01-01'),
  }
}

afterEach(() => vi.clearAllMocks())

async function openRowMenu() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Open menu' }))
}

describe('PatientTable row menu — Edit permission gate [H5]', () => {
  it('hides "Edit" when the caller lacks patients:update', async () => {
    mockUseCan.mockReturnValue(false)
    renderWithRouter(<PatientTable data={[patient()]} />)
    await openRowMenu()
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
  })

  it('shows "Edit" when the caller has patients:update', async () => {
    mockUseCan.mockReturnValue(true)
    renderWithRouter(<PatientTable data={[patient()]} />)
    await openRowMenu()
    expect(screen.getByText('Edit')).toBeInTheDocument()
  })
})
