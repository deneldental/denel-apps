/**
 * A patient needs an email address for the CRM email composer to reach them.
 * Add Patient promised one ("All fields are required except email") but had no
 * field, and Edit Patient had neither the patient's email nor — for a child —
 * the guardian's.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { AddPatientDialog } from '@/features/patients/components/add-patient-dialog'
import { EditPatientSheet } from '@/features/patients/components/edit-patient-sheet'
import type { Patient } from '@/features/patients/types/patient'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const mockGet = vi.mocked(api.get)
const mockPost = vi.mocked(api.post)
const mockPatch = vi.mocked(api.patch)

beforeAll(() => {
  // Radix Select relies on pointer-capture, scrolling and ResizeObserver,
  // which jsdom lacks.
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  // Tag catalog, insurance companies — every list the forms load starts empty.
  mockGet.mockResolvedValue({ success: true, data: [] })
  mockPost.mockResolvedValue({ success: true, data: { id: 'p-new' } })
  mockPatch.mockResolvedValue({ success: true, data: { id: 'p-1' } })
})

afterEach(() => vi.clearAllMocks())

/** The JSON body of the single call made to `path`. */
function bodySentTo(mock: typeof mockPost | typeof mockPatch, path: string) {
  const calls = mock.mock.calls.filter(([p]) => p === path)
  expect(calls).toHaveLength(1)
  return calls[0][1] as Record<string, unknown>
}

function makePatient(overrides: Record<string, unknown> = {}): Patient {
  return {
    id: 'p-1',
    patientId: 'DD-0001',
    name: 'Ama Mensah',
    email: 'old@example.com',
    phone: '0244123456',
    dob: new Date('1990-01-01T00:00:00'),
    gender: 'female',
    address: 'Accra',
    occupation: 'Teacher',
    nationality: 'Ghana',
    isChild: false,
    profileImage: null,
    guardianName: null,
    guardianPhone: null,
    guardianEmail: null,
    guardianAddress: null,
    guardianOccupation: null,
    tags: [],
    ...overrides,
  } as unknown as Patient
}

describe('Add Patient', () => {
  async function fillAdultPatient(user: ReturnType<typeof userEvent.setup>, email: string) {
    await user.click(screen.getByRole('button', { name: /add patient/i }))
    await user.type(await screen.findByLabelText(/^name$/i), 'Ama Mensah')
    await user.type(screen.getByLabelText(/^phone$/i), '0244123456')
    fireEvent.change(screen.getByLabelText(/^dob$/i), { target: { value: '1990-01-01' } })
    const genderTrigger = screen.getByText('Select gender').closest('button')
    if (!genderTrigger) throw new Error('gender select trigger not found')
    await user.click(genderTrigger)
    await user.click(await screen.findByRole('option', { name: 'Female' }))
    await user.type(screen.getByLabelText(/^email/i), email)
    await user.type(screen.getByLabelText(/^occupation$/i), 'Teacher')
    await user.type(screen.getByLabelText(/^address$/i), 'Accra')
  }

  it('records the email entered for an adult patient', async () => {
    const user = userEvent.setup()
    renderWithRouter(<AddPatientDialog />)

    await fillAdultPatient(user, 'ama@example.com')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(bodySentTo(mockPost, '/api/patients').email).toBe('ama@example.com')
  })

  it('sends nothing when the email is not a valid address', async () => {
    const user = userEvent.setup()
    renderWithRouter(<AddPatientDialog />)

    await fillAdultPatient(user, 'not-an-email')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    // Give a submit the chance to happen before asserting that it did not.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('Edit Patient', () => {
  function renderSheet(patient: Patient) {
    renderWithRouter(<EditPatientSheet patient={patient} open onOpenChange={vi.fn()} />)
  }

  it("shows the patient's saved email and saves a change", async () => {
    const user = userEvent.setup()
    renderSheet(makePatient())

    const email = await screen.findByLabelText(/^email/i)
    expect(email).toHaveValue('old@example.com')
    await user.clear(email)
    await user.type(email, 'new@example.com')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    expect(bodySentTo(mockPatch, '/api/patients/p-1').email).toBe('new@example.com')
  })

  it('clears the email when it is emptied', async () => {
    const user = userEvent.setup()
    renderSheet(makePatient())

    await user.clear(await screen.findByLabelText(/^email/i))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    expect(bodySentTo(mockPatch, '/api/patients/p-1').email).toBeNull()
  })

  it("shows and saves a child's guardian email", async () => {
    const user = userEvent.setup()
    renderSheet(
      makePatient({
        isChild: true,
        email: null,
        guardianName: 'Efua Mensah',
        guardianPhone: '0244123456',
        guardianAddress: 'Accra',
        guardianOccupation: 'Trader',
      })
    )

    await user.type(await screen.findByLabelText(/^guardian email/i), 'efua@example.com')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    const body = bodySentTo(mockPatch, '/api/patients/p-1')
    expect(body.guardianEmail).toBe('efua@example.com')
    expect(body.email).toBeNull()
  })
})

describe('Edit Patient keeps unsaved edits when the photo link is refreshed', () => {
  // The same stored photo, signed in two different 15-minute windows.
  const LINK_A =
    'https://denel-private.acct.r2.cloudflarestorage.com/avatars/ama.jpg?X-Amz-Date=20260927T100000Z&X-Amz-Signature=aaa'
  const LINK_B =
    'https://denel-private.acct.r2.cloudflarestorage.com/avatars/ama.jpg?X-Amz-Date=20260927T101500Z&X-Amz-Signature=bbb'

  it('keeps what the user typed when a refetch brings the patient back', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithRouter(
      <EditPatientSheet
        patient={makePatient({ profileImage: LINK_A })}
        open
        onOpenChange={vi.fn()}
      />
    )
    const occupation = await screen.findByLabelText(/^occupation$/i)
    await waitFor(() => expect(occupation).toHaveValue('Teacher'))
    await user.clear(occupation)
    await user.type(occupation, 'Nurse')

    rerender(
      <EditPatientSheet
        patient={makePatient({ profileImage: LINK_B })}
        open
        onOpenChange={vi.fn()}
      />
    )
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.getByLabelText(/^occupation$/i)).toHaveValue('Nurse')
  })

  it('does not count a refreshed photo link as an unsaved change', async () => {
    const { rerender } = renderWithRouter(
      <EditPatientSheet
        patient={makePatient({ profileImage: LINK_A })}
        open
        onOpenChange={vi.fn()}
      />
    )
    await waitFor(() => expect(screen.getByLabelText(/^occupation$/i)).toHaveValue('Teacher'))

    rerender(
      <EditPatientSheet
        patient={makePatient({ profileImage: LINK_B })}
        open
        onOpenChange={vi.fn()}
      />
    )
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })
})
