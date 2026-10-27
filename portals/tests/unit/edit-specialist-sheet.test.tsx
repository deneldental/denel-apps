/**
 * EditSpecialistSheet — the e-mail field (D17 / F48).
 *
 * A specialist with a login signs in with one address, and the specialist screens cannot change it.
 * The sheet used to offer the contact e-mail for editing anyway; saving it changed the billing
 * record and left the login alone, so an admin fixing a typo believed they had fixed the login.
 * Now the sheet shows the sign-in address as it is, read-only, and does not send an e-mail at all
 * for someone with a login; a specialist with no login keeps the editable field.
 *
 * The server's refusal of a different address is pinned in
 * backend/tests/integration/specialist-sync.test.ts.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditSpecialistSheet } from '@/features/specialists/components/edit-specialist-sheet'
import type { Specialist } from '@/lib/actions/specialists'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/actions/specialists', () => ({
  updateSpecialist: vi.fn(),
  listSpecialtyOptions: vi.fn(async () => []),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import { updateSpecialist } from '@/lib/actions/specialists'

const update = vi.mocked(updateSpecialist)

const specialist = (over: Partial<Specialist> = {}): Specialist => ({
  id: 'spec-1',
  name: 'Dr Jemima Adabor',
  specialty: null,
  profileImage: null,
  contactEmail: 'jemima@clinic.test',
  contactPhone: '0244000111',
  tin: null,
  specialistType: 'internal',
  userId: null,
  defaultCommissionRate: 10,
  withholdingTaxRate: 5,
  payoutMethod: null,
  payoutAccountDetails: null,
  gcalCalendarId: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
})

function setup(s: Specialist) {
  const onSaved = vi.fn()
  const onOpenChange = vi.fn()
  renderWithRouter(
    <EditSpecialistSheet specialist={s} open onOpenChange={onOpenChange} onSaved={onSaved} />
  )
  return { onSaved, onOpenChange }
}

beforeEach(() => {
  vi.resetAllMocks()
  update.mockResolvedValue({ data: {}, error: null } as never)
})

describe('a specialist with a login', () => {
  const withLogin = () =>
    specialist({
      userId: 'user-1',
      contactEmail: 'old.contact@clinic.test',
      signInEmail: 'jemima.login@clinic.test',
    })

  it('shows the address they sign in with, read-only', () => {
    setup(withLogin())

    const field = screen.getByLabelText('Sign-in email') as HTMLInputElement
    expect(field.value).toBe('jemima.login@clinic.test')
    expect(field).toBeDisabled()
    expect(screen.getByText(/can't be changed from here/i)).toBeInTheDocument()
  })

  it('does not send an e-mail when saving, only the other edits', async () => {
    const user = userEvent.setup()
    const { onSaved } = setup(withLogin())

    const phone = screen.getByLabelText('Phone')
    await user.clear(phone)
    await user.type(phone, '0244999888')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    const [id, payload] = update.mock.calls[0] as [string, Record<string, unknown>]
    expect(id).toBe('spec-1')
    expect(payload).not.toHaveProperty('contactEmail')
    expect(payload.contactPhone).toBe('0244999888')
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('falls back to the contact address when the response carries no sign-in address', () => {
    setup(specialist({ userId: 'user-1', contactEmail: 'only.this@clinic.test' }))

    expect((screen.getByLabelText('Sign-in email') as HTMLInputElement).value).toBe(
      'only.this@clinic.test'
    )
  })

  it('does not block saving over an old contact address that would not pass the e-mail check', async () => {
    const user = userEvent.setup()
    setup(
      specialist({ userId: 'user-1', contactEmail: 'not-an-email', signInEmail: 'ok@clinic.test' })
    )

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('a specialist with no login', () => {
  it('keeps the e-mail editable and sends it, trimmed', async () => {
    const user = userEvent.setup()
    setup(specialist({ userId: null }))

    const email = screen.getByLabelText('Email') as HTMLInputElement
    expect(email).toBeEnabled()
    await user.clear(email)
    await user.type(email, '  new.address@clinic.test  ')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    const [, payload] = update.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.contactEmail).toBe('new.address@clinic.test')
  })

  it('still rejects an address that is not an e-mail, before sending anything', async () => {
    const user = userEvent.setup()
    setup(specialist({ userId: null }))

    const email = screen.getByLabelText('Email')
    await user.clear(email)
    await user.type(email, 'nonsense')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(toast.error).toHaveBeenCalledWith('That email address looks invalid.')
    expect(update).not.toHaveBeenCalled()
  })
})
