/**
 * Pins the fix for finding H5 (bullet 2)
 * (project-docs/patient-records-and-scheduling-audit.md): "Remove Block" had
 * no permission check at all in the UI, while the backend requires
 * appointments:delete (`DELETE /api/doctors/unavailability/:id`) — an
 * always-403 trap for anyone lacking it. The button is now gated on
 * `useCan('appointments', 'delete')`.
 */
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnavailabilityDetailDialog } from '@/features/appointments/components/unavailability-detail-dialog'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/actions/doctor-availability', () => ({
  deleteUnavailability: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/permissions-context', () => ({ useCan: vi.fn() }))

import { useCan } from '@/lib/permissions-context'

const mockUseCan = vi.mocked(useCan)

const unavailability = {
  id: 'unavail-1',
  doctorId: 'doc-1',
  startTime: new Date('2027-01-15T09:00:00Z'),
  endTime: new Date('2027-01-15T10:00:00Z'),
  reason: 'Lunch',
  doctor: { user: { name: 'Dr. Mensah' } },
}

afterEach(() => vi.clearAllMocks())

describe('UnavailabilityDetailDialog — Remove Block permission gate [H5]', () => {
  it('hides "Remove Block" when the caller lacks appointments:delete', () => {
    mockUseCan.mockReturnValue(false)
    renderWithRouter(
      <UnavailabilityDetailDialog open onOpenChange={() => {}} unavailability={unavailability} />
    )
    expect(screen.queryByText('Remove Block')).not.toBeInTheDocument()
  })

  it('shows "Remove Block" when the caller has appointments:delete', () => {
    mockUseCan.mockReturnValue(true)
    renderWithRouter(
      <UnavailabilityDetailDialog open onOpenChange={() => {}} unavailability={unavailability} />
    )
    expect(screen.getByText('Remove Block')).toBeInTheDocument()
  })
})
