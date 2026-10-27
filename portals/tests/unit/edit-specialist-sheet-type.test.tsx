/**
 * EditSpecialistSheet — the Type is shown, not edited.
 *
 * It used to be a dropdown. Flipping it to "Internal" changed a label and
 * nothing else — no login, no way to sign in — so a specialist could claim to
 * be internal while being unable to. Becoming internal now goes through "Grant
 * portal login"; the sheet says so, and no longer sends `specialistType` at all
 * (the backend refuses a change anyway).
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EditSpecialistSheet } from '@/features/specialists/components/edit-specialist-sheet'
import type { Specialist } from '@/lib/actions/specialists'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/actions/specialists', () => ({
  updateSpecialist: vi.fn().mockResolvedValue({ success: true }),
  listSpecialtyOptions: vi.fn().mockResolvedValue({ data: [] }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { updateSpecialist } from '@/lib/actions/specialists'

const mockUpdate = vi.mocked(updateSpecialist)

beforeAll(() => {
  // Radix Select (the specialty picker) needs these in JSDOM.
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.scrollIntoView = () => {}
})

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
  defaultCommissionRate: 10,
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
  const onSaved = vi.fn()
  renderWithRouter(
    <EditSpecialistSheet
      specialist={specialist(over)}
      open
      onOpenChange={vi.fn()}
      onSaved={onSaved}
    />
  )
  return { onSaved }
}

afterEach(() => vi.clearAllMocks())

describe('EditSpecialistSheet — type', () => {
  it('shows an external specialist as external and points at the way to give them a login', async () => {
    setup({ specialistType: 'external' })
    expect(await screen.findByTestId('specialist-type')).toHaveTextContent(/external/i)
    expect(screen.getByText(/grant portal login/i)).toBeInTheDocument()
  })

  it('shows an internal specialist as internal and fixed', async () => {
    setup({ specialistType: 'internal' })
    expect(await screen.findByTestId('specialist-type')).toHaveTextContent(/internal/i)
    expect(screen.getByText(/type is fixed once set/i)).toBeInTheDocument()
  })

  it('offers no control for changing it', async () => {
    setup()
    await screen.findByTestId('specialist-type')
    expect(screen.queryByRole('combobox', { name: /^type$/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^type$/i)).not.toBeInTheDocument()
  })

  it('saves without sending the type', async () => {
    const user = userEvent.setup()
    const { onSaved } = setup()
    await screen.findByTestId('specialist-type')

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    const [id, payload] = mockUpdate.mock.calls[0]
    expect(id).toBe('spec-1')
    expect(payload).not.toHaveProperty('specialistType')
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })
})
