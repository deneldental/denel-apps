/**
 * SpecialistStatusButton — deactivate / reactivate.
 *
 * Deactivating is the delete-side privilege and reactivating an ordinary update,
 * so each side only appears for a caller who holds the matching permission. The
 * confirmation has to be honest about the login: the backend suspends it on
 * deactivation, and a button that said "hides them from booking" while also
 * locking someone out of the system would be a nasty surprise.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpecialistStatusButton } from '@/features/specialists/components/specialist-status-button'
import type { Specialist } from '@/lib/actions/specialists'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/actions/specialists', () => ({
  deactivateSpecialist: vi.fn(),
  reactivateSpecialist: vi.fn(),
}))
vi.mock('@/lib/permissions-context', () => ({ useCan: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import { deactivateSpecialist, reactivateSpecialist } from '@/lib/actions/specialists'
import { useCan } from '@/lib/permissions-context'

const mockDeactivate = vi.mocked(deactivateSpecialist)
const mockReactivate = vi.mocked(reactivateSpecialist)
const mockUseCan = vi.mocked(useCan)

/** Grant exactly these specialists:<action> permissions. */
function allow(...actions: string[]) {
  mockUseCan.mockImplementation((_module, action) => actions.includes(action))
}

const specialist = (over: Partial<Specialist> = {}): Specialist => ({
  id: 'spec-1',
  name: 'Dr Jemima Adabor',
  specialty: null,
  profileImage: null,
  contactEmail: null,
  contactPhone: null,
  tin: null,
  specialistType: 'internal',
  userId: null,
  defaultCommissionRate: 0,
  withholdingTaxRate: 0,
  payoutMethod: null,
  payoutAccountDetails: null,
  gcalCalendarId: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
})

function setup(over: Partial<Specialist> = {}) {
  const onChanged = vi.fn()
  renderWithRouter(<SpecialistStatusButton specialist={specialist(over)} onChanged={onChanged} />)
  return { onChanged }
}

afterEach(() => vi.clearAllMocks())

describe('SpecialistStatusButton — who sees what', () => {
  it('offers Deactivate to someone with specialists:delete', () => {
    allow('delete')
    setup()
    expect(screen.getByRole('button', { name: /deactivate/i })).toBeInTheDocument()
  })

  it('offers nothing for an active specialist when the caller can only update', () => {
    allow('update', 'read', 'create')
    setup()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers Reactivate to someone with specialists:update', () => {
    allow('update')
    setup({ isActive: false })
    expect(screen.getByRole('button', { name: /reactivate/i })).toBeInTheDocument()
  })

  it('offers nothing for an inactive specialist when the caller can only delete', () => {
    allow('delete')
    setup({ isActive: false })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('SpecialistStatusButton — deactivating', () => {
  it('asks first, and cancelling sends nothing', async () => {
    const user = userEvent.setup()
    allow('delete')
    const { onChanged } = setup()

    await user.click(screen.getByRole('button', { name: /deactivate/i }))
    expect(await screen.findByText('Deactivate Dr Jemima Adabor?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockDeactivate).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('deactivates on confirm, tells the admin, and asks the page to refetch', async () => {
    const user = userEvent.setup()
    allow('delete')
    mockDeactivate.mockResolvedValue({ success: true })
    const { onChanged } = setup()

    await user.click(screen.getByRole('button', { name: /^deactivate$/i }))
    await user.click(await screen.findByRole('button', { name: 'Deactivate', hidden: false }))

    await waitFor(() => expect(mockDeactivate).toHaveBeenCalledWith('spec-1'))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith('Dr Jemima Adabor deactivated')
  })

  it('warns that the login is suspended — only when there is a login', async () => {
    const user = userEvent.setup()
    allow('delete')
    const { unmount } = (() => {
      const onChanged = vi.fn()
      const utils = renderWithRouter(
        <SpecialistStatusButton specialist={specialist({ userId: 'u-1' })} onChanged={onChanged} />
      )
      return utils
    })()

    await user.click(screen.getByRole('button', { name: /deactivate/i }))
    expect(await screen.findByText(/login is suspended/i)).toBeInTheDocument()
    unmount()

    setup({ userId: null })
    await user.click(screen.getByRole('button', { name: /deactivate/i }))
    expect(await screen.findByText(/no longer appear when booking/i)).toBeInTheDocument()
    expect(screen.queryByText(/login is suspended/i)).not.toBeInTheDocument()
  })

  // If the request fails the admin has not deactivated anyone. The dialog must
  // say so and stay up, not close as though it had worked.
  it('reports a failure, keeps the dialog open, and does not claim success', async () => {
    const user = userEvent.setup()
    allow('delete')
    mockDeactivate.mockResolvedValue({ success: false, error: 'Unauthorized' })
    const { onChanged } = setup()

    await user.click(screen.getByRole('button', { name: /^deactivate$/i }))
    await user.click(await screen.findByRole('button', { name: 'Deactivate', hidden: false }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Unauthorized'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.getByText('Deactivate Dr Jemima Adabor?')).toBeInTheDocument()
  })
})

describe('SpecialistStatusButton — reactivating', () => {
  it('reactivates on confirm', async () => {
    const user = userEvent.setup()
    allow('update')
    mockReactivate.mockResolvedValue({ success: true })
    const { onChanged } = setup({ isActive: false, userId: 'u-1' })

    await user.click(screen.getByRole('button', { name: /^reactivate$/i }))
    expect(await screen.findByText(/login is restored/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reactivate', hidden: false }))

    await waitFor(() => expect(mockReactivate).toHaveBeenCalledWith('spec-1'))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(mockDeactivate).not.toHaveBeenCalled()
  })
})
