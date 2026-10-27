/**
 * SpecialistAccessStep — the Access tab on a specialist's page.
 *
 * The bug behind it: for an external specialist, or an internal one with no
 * login, this tab was a dead end ("re-create the record via the wizard"), and
 * nothing anywhere could give them a login. It now offers "Grant portal login"
 * — to someone allowed to use it, and only where it can work.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpecialistAccessStep } from '@/features/specialists/components/specialist-access-step'
import type { Specialist } from '@/lib/actions/specialists'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/permissions-context', () => ({ useCan: vi.fn() }))
vi.mock('@/lib/actions/specialists', () => ({ grantSpecialistLogin: vi.fn() }))
vi.mock('@/features/staff/components/permissions-tab', () => ({
  PermissionsTab: ({ userId }: { userId: string }) => <div>permissions for {userId}</div>,
}))

import { useCan } from '@/lib/permissions-context'

const mockUseCan = vi.mocked(useCan)

function allow(...actions: string[]) {
  mockUseCan.mockImplementation((_module, action) => actions.includes(action))
}

const specialist = (over: Partial<Specialist> = {}): Specialist => ({
  id: 'spec-1',
  name: 'Dr Jemima Adabor',
  specialty: null,
  profileImage: null,
  contactEmail: 'jemima@clinic.test',
  contactPhone: null,
  tin: null,
  specialistType: 'external',
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

const render = (over: Partial<Specialist> = {}) =>
  renderWithRouter(<SpecialistAccessStep specialist={specialist(over)} onChanged={vi.fn()} />)

const grantButton = () => screen.queryByRole('button', { name: /grant portal login/i })

afterEach(() => vi.clearAllMocks())

describe('SpecialistAccessStep', () => {
  it('offers to grant a login to an external specialist, and explains what that means', () => {
    allow('update', 'create')
    render({ specialistType: 'external' })
    expect(grantButton()).toBeEnabled()
    expect(screen.getByText(/which makes them an internal specialist/i)).toBeInTheDocument()
  })

  it('offers it to an internal specialist who never got a login', () => {
    allow('update', 'create')
    render({ specialistType: 'internal', userId: null })
    expect(grantButton()).toBeEnabled()
    expect(screen.getByText(/has no login, so they can't sign in/i)).toBeInTheDocument()
  })

  it('opens the grant dialog from the button', async () => {
    const user = userEvent.setup()
    allow('update', 'create')
    render()
    await user.click(grantButton() as HTMLElement)
    expect(await screen.findByRole('heading', { name: 'Grant portal login' })).toBeInTheDocument()
  })

  // Granting edits a record AND mints credentials: both privileges are required,
  // and the backend refuses with only one.
  it.each([
    ['update'],
    ['create'],
  ])('does not offer the button with only specialists:%s', (only) => {
    allow(only)
    render()
    expect(grantButton()).not.toBeInTheDocument()
    // The explanation stays — only the action is withheld.
    expect(screen.getByText(/external specialists don't sign in/i)).toBeInTheDocument()
  })

  it('disables the button for an inactive specialist and says why', () => {
    allow('update', 'create')
    render({ isActive: false })
    expect(grantButton()).toBeDisabled()
    expect(
      screen.getByText(/reactivate this specialist before granting a login/i)
    ).toBeInTheDocument()
  })

  it('shows the permissions surface — not the grant button — once there is a login', () => {
    allow('update', 'create')
    render({ specialistType: 'internal', userId: 'user-9' })
    expect(screen.getByText('permissions for user-9')).toBeInTheDocument()
    expect(grantButton()).not.toBeInTheDocument()
  })
})
