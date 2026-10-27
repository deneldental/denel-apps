/**
 * Specialists list — showing inactive specialists.
 *
 * Deactivating someone only helps if you can find them again: reactivation
 * happens on their page, and the list used to hide inactive rows and refuse to
 * open them. Two things are pinned here: the toggle brings them back AND makes
 * them openable, and the inactive-inclusive query lives under its own key —
 * the invoice composer, kiosk and service pages share the plain list key and
 * must never be handed inactive doctors.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SpecialistsPage from '@/features/specialists/pages/index'
import type { Specialist } from '@/lib/actions/specialists'
import { queryKeys } from '@/lib/query-keys'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/actions/specialists', () => ({
  listSpecialists: vi.fn(),
  createSpecialist: vi.fn(),
  listSpecialtyOptions: vi.fn().mockResolvedValue({ data: [] }),
}))
vi.mock('@/lib/permissions-context', () => ({ useCan: vi.fn().mockReturnValue(false) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { listSpecialists } from '@/lib/actions/specialists'

const mockList = vi.mocked(listSpecialists)

const row = (over: Partial<Specialist>): Specialist => ({
  id: 'x',
  name: 'x',
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

const ACTIVE = row({ id: 'a-1', name: 'Dr Active' })
const INACTIVE = row({ id: 'i-1', name: 'Dr Retired', isActive: false })

/** The backend hides inactive rows unless asked; the mock does the same. */
function backend() {
  mockList.mockImplementation(async (opts) => ({
    success: true,
    data: opts?.includeInactive ? [ACTIVE, INACTIVE] : [ACTIVE],
    error: undefined,
  }))
}

function renderPage() {
  return renderWithRouter(
    <Routes>
      <Route path="/" element={<SpecialistsPage />} />
      <Route path="/specialists/:id" element={<div>detail page</div>} />
    </Routes>
  )
}

afterEach(() => vi.clearAllMocks())

describe('Specialists list — inactive specialists', () => {
  it('hides inactive specialists by default and asks the API for active ones only', async () => {
    backend()
    renderPage()

    expect(await screen.findByText('Dr Active')).toBeInTheDocument()
    expect(screen.queryByText('Dr Retired')).not.toBeInTheDocument()
    expect(mockList).toHaveBeenCalledWith({ includeInactive: false })
  })

  it('"Show inactive" brings them back, marked inactive', async () => {
    const user = userEvent.setup()
    backend()
    renderPage()
    await screen.findByText('Dr Active')

    await user.click(screen.getByRole('switch', { name: /show inactive/i }))

    expect(await screen.findByText('Dr Retired')).toBeInTheDocument()
    expect(mockList).toHaveBeenCalledWith({ includeInactive: true })
    expect(screen.getByText('inactive')).toBeInTheDocument()
  })

  // The dead end this fixes: an inactive row used to ignore clicks, so a
  // deactivated specialist could never be opened — and so never reactivated.
  it('lets an inactive specialist be opened, so they can be reactivated', async () => {
    const user = userEvent.setup()
    backend()
    renderPage()
    await screen.findByText('Dr Active')
    await user.click(screen.getByRole('switch', { name: /show inactive/i }))

    await user.click(await screen.findByText('Dr Retired'))

    await waitFor(() => expect(screen.getByText('detail page')).toBeInTheDocument())
  })

  it('hides them again when the toggle is turned off', async () => {
    const user = userEvent.setup()
    backend()
    renderPage()
    await screen.findByText('Dr Active')
    const toggle = screen.getByRole('switch', { name: /show inactive/i })

    await user.click(toggle)
    await screen.findByText('Dr Retired')
    await user.click(toggle)

    await waitFor(() => expect(screen.queryByText('Dr Retired')).not.toBeInTheDocument())
  })
})

describe('specialists query keys', () => {
  it('keeps the inactive-inclusive list out of the key other screens share', () => {
    expect(queryKeys.specialists.listWithInactive()).not.toEqual(queryKeys.specialists.list())
  })

  // Invalidating `list()` after a deactivate must refresh the inclusive list
  // too — TanStack matches by prefix, so `list()` has to be a prefix of it.
  it('stays under list() so invalidating the plain list refreshes it as well', () => {
    const plain = queryKeys.specialists.list()
    expect(queryKeys.specialists.listWithInactive().slice(0, plain.length)).toEqual([...plain])
  })
})
