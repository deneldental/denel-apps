/**
 * GrantLoginDialog — giving an existing specialist a portal login.
 *
 * Pins the behaviour that matters to the person at the keyboard: nothing is sent
 * until the form is valid; a refusal (usually "that email already has a login")
 * stays on screen with what they typed so they can fix it; one click is one
 * request; and a background refetch can't wipe a half-typed password.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GrantLoginDialog } from '@/features/specialists/components/grant-login-dialog'
import type { Specialist } from '@/lib/actions/specialists'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/actions/specialists', () => ({ grantSpecialistLogin: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import { grantSpecialistLogin } from '@/lib/actions/specialists'

const mockGrant = vi.mocked(grantSpecialistLogin)

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

function setup(over: Partial<Specialist> = {}) {
  const onOpenChange = vi.fn()
  const onGranted = vi.fn()
  const utils = renderWithRouter(
    <GrantLoginDialog
      specialist={specialist(over)}
      open
      onOpenChange={onOpenChange}
      onGranted={onGranted}
    />
  )
  return { onOpenChange, onGranted, ...utils }
}

const password = () => screen.getByLabelText('Temporary password') as HTMLInputElement
const email = () => screen.getByLabelText('Sign-in email') as HTMLInputElement
const submit = () => screen.getByRole('button', { name: 'Grant login' })

afterEach(() => vi.clearAllMocks())

describe('GrantLoginDialog', () => {
  it('says what an external specialist is about to become', async () => {
    setup({ specialistType: 'external' })
    expect(await screen.findByText(/external specialist/i)).toBeInTheDocument()
    expect(screen.getByText(/makes them an internal specialist/i)).toBeInTheDocument()
  })

  it('does not claim a type change for an internal specialist who just has no login', async () => {
    setup({ specialistType: 'internal' })
    expect(await screen.findByText(/has no login yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/makes them an internal specialist/i)).not.toBeInTheDocument()
  })

  it("pre-fills the specialist's contact email and leaves the password empty", async () => {
    setup()
    await waitFor(() => expect(email().value).toBe('jemima@clinic.test'))
    expect(password().value).toBe('')
  })

  it('sends nothing for a password under 10 characters', async () => {
    const user = userEvent.setup()
    const { onGranted } = setup()
    await waitFor(() => expect(email().value).toBe('jemima@clinic.test'))

    await user.type(password(), 'short')
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 10 characters/i)
    expect(mockGrant).not.toHaveBeenCalled()
    expect(onGranted).not.toHaveBeenCalled()
  })

  it('sends nothing for a malformed email', async () => {
    const user = userEvent.setup()
    setup({ contactEmail: null })
    await user.type(email(), 'not-an-email')
    await user.type(password(), 'a-long-enough-password')
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i)
    expect(mockGrant).not.toHaveBeenCalled()
  })

  it('grants the login, tells the admin, closes, and asks the page to refetch', async () => {
    const user = userEvent.setup()
    mockGrant.mockResolvedValue({ success: true })
    const { onOpenChange, onGranted } = setup()
    await waitFor(() => expect(email().value).toBe('jemima@clinic.test'))

    // Surrounding spaces in the email are trimmed; the password is sent as typed.
    await user.clear(email())
    await user.type(email(), '  jemima.adabor@clinic.test  ')
    await user.type(password(), 'a-long-enough-password')
    await user.click(submit())

    await waitFor(() => expect(mockGrant).toHaveBeenCalledTimes(1))
    expect(mockGrant).toHaveBeenCalledWith('spec-1', {
      email: 'jemima.adabor@clinic.test',
      password: 'a-long-enough-password',
    })
    await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Dr Jemima Adabor'))
  })

  // The usual refusal is an email that already has a login. The admin fixes it by
  // changing the email — so the dialog must stay, show why, and keep their input.
  it('shows the server refusal, stays open, and keeps what was typed', async () => {
    const user = userEvent.setup()
    mockGrant.mockResolvedValue({ success: false, error: 'That email already has a login.' })
    const { onOpenChange, onGranted } = setup()
    await waitFor(() => expect(email().value).toBe('jemima@clinic.test'))

    await user.type(password(), 'a-long-enough-password')
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent('That email already has a login.')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(onGranted).not.toHaveBeenCalled()
    expect(email().value).toBe('jemima@clinic.test')
    expect(password().value).toBe('a-long-enough-password')
  })

  it('sends one request however many times submit is triggered while it is in flight', async () => {
    const user = userEvent.setup()
    let finish!: (v: { success: boolean }) => void
    mockGrant.mockReturnValue(new Promise((r) => (finish = r)))
    setup()
    await waitFor(() => expect(email().value).toBe('jemima@clinic.test'))
    await user.type(password(), 'a-long-enough-password')

    fireEvent.submit(password().closest('form') as HTMLFormElement)
    fireEvent.submit(password().closest('form') as HTMLFormElement)
    fireEvent.submit(password().closest('form') as HTMLFormElement)

    expect(mockGrant).toHaveBeenCalledTimes(1)
    finish({ success: true })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  // A background refetch hands the dialog a new specialist object. Re-seeding on
  // that would blank a password the admin is halfway through typing.
  it('keeps a half-typed password when the specialist is refetched', async () => {
    const user = userEvent.setup()
    const { rerender } = setup()
    await waitFor(() => expect(email().value).toBe('jemima@clinic.test'))
    await user.type(password(), 'half-typed')

    rerender(
      <GrantLoginDialog
        specialist={specialist({ updatedAt: '2026-02-02T00:00:00Z' })}
        open
        onOpenChange={vi.fn()}
        onGranted={vi.fn()}
      />
    )

    // The seed runs in a microtask — flush it, or this asserts before a wipe
    // could possibly have happened and proves nothing.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(password().value).toBe('half-typed')
  })

  it('opens clean after a cancelled attempt — no password left behind', async () => {
    const user = userEvent.setup()
    const props = { specialist: specialist(), onOpenChange: vi.fn(), onGranted: vi.fn() }
    const { rerender } = renderWithRouter(<GrantLoginDialog {...props} open />)
    await waitFor(() => expect(email().value).toBe('jemima@clinic.test'))
    await user.type(password(), 'abandoned-password')

    rerender(<GrantLoginDialog {...props} open={false} />)
    rerender(<GrantLoginDialog {...props} open />)

    await waitFor(() => expect(password().value).toBe(''))
  })
})
