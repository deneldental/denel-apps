/**
 * F02 / F17 — the patient's Estimates tab, as a doctor uses it. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 4).
 *
 * Three things were wrong: it listed through `/api/invoices/patient/:id`
 * (`payments:read`, so a doctor saw an empty list and "No pending estimates"); its
 * buttons were gated on `clinical:manage` / `patients:manage`, permissions that
 * have nothing to do with estimates; and "Generate Invoice" reached an endpoint that
 * invented a checked-in visit. It now reads `/api/estimates/patient/:id`, gates on
 * `estimates:create` / `estimates:update`, and reports a failed load as a failure.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const perms = vi.hoisted(() => ({ held: new Set<string>(), admin: false }))

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/shared/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    menuItems: [],
    isAdmin: perms.admin,
    roleId: 'doctor',
    roleName: 'Doctor',
    isLoading: false,
    error: null,
    hasPermission: (module: string, action: string) =>
      perms.admin || perms.held.has(`${module}:${action}`),
    canAccess: () => true,
    refetch: async () => {},
  }),
}))
// The builder is a large screen with its own tests; here it is only a marker.
vi.mock('@/features/activity/components/create-estimate-sheet', () => ({
  CreateEstimateSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-estimate-sheet" /> : null,
}))

import { toast } from 'sonner'
import { PatientEstimatesTab } from '@/features/patient-cases/components/patient-estimates-tab'
import { api } from '@/lib/api-client'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'est-1',
  invoiceNumber: 'INV-0042',
  description: 'Crown on 36',
  status: 'draft',
  total: 150000,
  createdAt: '2026-10-20T09:00:00.000Z',
  ...over,
})

function route(handlers: Record<string, () => unknown>) {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    for (const [prefix, fn] of Object.entries(handlers)) {
      if (url.startsWith(prefix)) return fn()
    }
    return { success: false, error: `unexpected GET ${url}` }
  }) as never)
}

const PATIENT = { success: true, data: { id: 'p-1', name: 'Ama Mensah' } }

beforeEach(() => {
  perms.held = new Set()
  perms.admin = false
})
afterEach(() => vi.resetAllMocks())

describe('PatientEstimatesTab — what a doctor sees', () => {
  it('lists through the clinical endpoint and never the invoice list', async () => {
    perms.held = new Set(['estimates:read'])
    route({
      '/api/patients/': () => PATIENT,
      '/api/estimates/patient/p-1': () => ({ success: true, data: [row()] }),
    })
    render(<PatientEstimatesTab patientId="p-1" canEdit />)

    expect(await screen.findByText('INV-0042')).toBeInTheDocument()
    expect(screen.getByText('Crown on 36')).toBeInTheDocument()
    for (const [url] of vi.mocked(api.get).mock.calls) {
      expect(String(url)).not.toContain('/api/invoices')
    }
  })

  it('shows only estimates, as the server returns them (no client-side type filter needed)', async () => {
    perms.held = new Set(['estimates:read'])
    route({
      '/api/patients/': () => PATIENT,
      '/api/estimates/patient/p-1': () => ({
        success: true,
        data: [row({ id: 'a', invoiceNumber: 'INV-A' }), row({ id: 'b', invoiceNumber: 'INV-B' })],
      }),
    })
    render(<PatientEstimatesTab patientId="p-1" canEdit />)
    expect(await screen.findByText('INV-A')).toBeInTheDocument()
    expect(screen.getByText('INV-B')).toBeInTheDocument()
  })

  it('says so when the list could not be loaded, instead of "No pending estimates"', async () => {
    perms.held = new Set(['estimates:read'])
    route({
      '/api/patients/': () => PATIENT,
      '/api/estimates/patient/p-1': () => ({ success: false, error: 'Unauthorized' }),
    })
    render(<PatientEstimatesTab patientId="p-1" canEdit />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load estimates/i)
    expect(alert).toHaveTextContent(/unauthorized/i)
    expect(screen.queryByText(/no pending estimates/i)).not.toBeInTheDocument()
  })

  it('retries a failed load', async () => {
    perms.held = new Set(['estimates:read'])
    let calls = 0
    route({
      '/api/patients/': () => PATIENT,
      '/api/estimates/patient/p-1': () =>
        ++calls === 1
          ? { success: false, error: 'Server error' }
          : { success: true, data: [row()] },
    })
    const user = userEvent.setup()
    render(<PatientEstimatesTab patientId="p-1" canEdit />)

    await user.click(await screen.findByRole('button', { name: /retry/i }))
    expect(await screen.findByText('INV-0042')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the genuine empty state when there are none', async () => {
    perms.held = new Set(['estimates:read'])
    route({
      '/api/patients/': () => PATIENT,
      '/api/estimates/patient/p-1': () => ({ success: true, data: [] }),
    })
    render(<PatientEstimatesTab patientId="p-1" canEdit />)
    expect(await screen.findByText(/no pending estimates/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('PatientEstimatesTab — gated on the estimate permissions', () => {
  const loaded = () =>
    route({
      '/api/patients/': () => PATIENT,
      '/api/estimates/patient/p-1': () => ({ success: true, data: [row()] }),
    })

  it('offers "Create Estimate" to a doctor, who holds estimates:create and no clinical:manage', async () => {
    perms.held = new Set(['estimates:read', 'estimates:create'])
    loaded()
    render(<PatientEstimatesTab patientId="p-1" canEdit />)
    await screen.findByText('INV-0042')
    expect(screen.getByRole('button', { name: /create estimate/i })).toBeInTheDocument()
  })

  it('hides "Create Estimate" from someone without estimates:create, whatever else they hold', async () => {
    perms.held = new Set(['estimates:read', 'clinical:manage', 'patients:manage'])
    loaded()
    render(<PatientEstimatesTab patientId="p-1" canEdit />)
    await screen.findByText('INV-0042')
    expect(screen.queryByRole('button', { name: /create estimate/i })).not.toBeInTheDocument()
  })

  it('opens the builder when "Create Estimate" is used', async () => {
    perms.held = new Set(['estimates:read', 'estimates:create'])
    loaded()
    const user = userEvent.setup()
    render(<PatientEstimatesTab patientId="p-1" canEdit />)
    await user.click(await screen.findByRole('button', { name: /create estimate/i }))
    expect(screen.getByTestId('create-estimate-sheet')).toBeInTheDocument()
  })

  it('offers "Send to reception" on a draft to someone with estimates:update', async () => {
    perms.held = new Set(['estimates:read', 'estimates:update'])
    loaded()
    render(<PatientEstimatesTab patientId="p-1" canEdit />)
    await screen.findByText('INV-0042')
    expect(screen.getByRole('button', { name: /send to reception/i })).toBeInTheDocument()
  })

  it('does not offer it without estimates:update, on a non-draft, or on a read-only screen', async () => {
    perms.held = new Set(['estimates:read'])
    loaded()
    const { unmount } = render(<PatientEstimatesTab patientId="p-1" canEdit />)
    await screen.findByText('INV-0042')
    expect(screen.queryByRole('button', { name: /send to reception/i })).not.toBeInTheDocument()
    unmount()

    perms.held = new Set(['estimates:read', 'estimates:update'])
    route({
      '/api/patients/': () => PATIENT,
      '/api/estimates/patient/p-1': () => ({ success: true, data: [row({ status: 'issued' })] }),
    })
    const second = render(<PatientEstimatesTab patientId="p-1" canEdit />)
    await screen.findByText('INV-0042')
    expect(screen.queryByRole('button', { name: /send to reception/i })).not.toBeInTheDocument()
    second.unmount()

    loaded()
    render(<PatientEstimatesTab patientId="p-1" canEdit={false} />)
    await screen.findByText('INV-0042')
    expect(screen.queryByRole('button', { name: /send to reception/i })).not.toBeInTheDocument()
  })
})

describe('PatientEstimatesTab — sending to reception', () => {
  const draftLoaded = () => {
    perms.held = new Set(['estimates:read', 'estimates:update'])
    route({
      '/api/patients/': () => PATIENT,
      '/api/estimates/patient/p-1': () => ({ success: true, data: [row()] }),
    })
  }

  it('posts to the send endpoint, tells the user, and reloads the list', async () => {
    draftLoaded()
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { appointmentId: null } })
    const user = userEvent.setup()
    render(<PatientEstimatesTab patientId="p-1" canEdit />)

    await user.click(await screen.findByRole('button', { name: /send to reception/i }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/invoices/est-1/send-to-reception', {})
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    // "Generate Invoice" claimed to make an invoice; nothing is generated.
    expect(String(vi.mocked(toast.success).mock.calls[0][0])).not.toMatch(/invoice generated/i)
    const listCalls = vi
      .mocked(api.get)
      .mock.calls.filter(([u]) => String(u).startsWith('/api/estimates/patient/p-1'))
    expect(listCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('shows the server’s reason when sending fails, and does not claim success', async () => {
    draftLoaded()
    vi.mocked(api.post).mockResolvedValue({ success: false, error: 'Invoice is not a draft' })
    const user = userEvent.setup()
    render(<PatientEstimatesTab patientId="p-1" canEdit />)

    await user.click(await screen.findByRole('button', { name: /send to reception/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invoice is not a draft'))
    expect(toast.success).not.toHaveBeenCalled()
  })
})
