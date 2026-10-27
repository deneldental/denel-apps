/**
 * F02 (plan step) — "Create treatment plan" for a doctor. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 4): a doctor completes
 * estimate → view → plan without financial permissions.
 *
 * The sheet seeds the plan from the estimate's lines. It read `/api/invoices/:id`
 * (`payments:read`), so for a doctor the load failed and the sheet opened with an
 * empty procedure list and no explanation. It now reads the clinical
 * `/api/estimates/:id`, keeps each line's catalogue service through to the plan, and
 * says when the estimate could not be loaded.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/features/clinical/use-clinical-preferences', () => ({
  useToothNotation: () => ({ toothLabel: (n: number) => String(n) }),
}))

import { toast } from 'sonner'
import { CreateTreatmentPlanSheet } from '@/features/activity/components/create-treatment-plan-sheet'
import { api } from '@/lib/api-client'

beforeAll(() => {
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
afterEach(() => vi.resetAllMocks())

const estimate = {
  success: true as const,
  data: {
    id: 'est-1',
    invoiceNumber: 'INV-0042',
    status: 'issued',
    total: 40000,
    lines: [
      {
        id: 'l1',
        serviceId: 'svc-1',
        description: 'Composite filling',
        quantity: 1,
        unitPrice: 25000,
        lineTotal: 25000,
        variantName: null,
      },
      {
        id: 'l2',
        serviceId: 'svc-2',
        description: 'Scale and polish',
        quantity: 1,
        unitPrice: 15000,
        lineTotal: 15000,
        variantName: null,
      },
    ],
  },
}

const renderSheet = (onCreated = vi.fn()) => {
  render(
    <CreateTreatmentPlanSheet
      open
      onOpenChange={() => {}}
      patientId="p-1"
      patientName="Ama Mensah"
      estimateInvoiceId="est-1"
      onCreated={onCreated}
    />
  )
  return { onCreated }
}

describe('CreateTreatmentPlanSheet — seeding from an estimate', () => {
  it('reads the clinical estimate endpoint, never the invoice one', async () => {
    vi.mocked(api.get).mockResolvedValue(estimate)
    renderSheet()
    await screen.findByDisplayValue('Composite filling')
    expect(api.get).toHaveBeenCalledWith('/api/estimates/est-1')
    for (const [url] of vi.mocked(api.get).mock.calls) {
      expect(String(url)).not.toContain('/api/invoices')
    }
  })

  it('seeds a procedure for every line and titles the plan after the estimate', async () => {
    vi.mocked(api.get).mockResolvedValue(estimate)
    renderSheet()
    expect(await screen.findByDisplayValue('Composite filling')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Scale and polish')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Plan from INV-0042')).toBeInTheDocument()
  })

  it('creates the plan with each procedure’s catalogue service', async () => {
    vi.mocked(api.get).mockResolvedValue(estimate)
    vi.mocked(api.post).mockResolvedValue({ success: true, data: {} })
    const user = userEvent.setup()
    const { onCreated } = renderSheet()
    await screen.findByDisplayValue('Composite filling')

    await user.click(screen.getByRole('button', { name: /confirm treatment plan/i }))

    await waitFor(() => expect(api.post).toHaveBeenCalled())
    const [url, body] = vi.mocked(api.post).mock.calls[0] as [
      string,
      {
        patientId: string
        title: string
        items: Array<{ serviceId: string; procedureName: string }>
      },
    ]
    expect(url).toBe('/api/treatment-plans')
    expect(body.patientId).toBe('p-1')
    expect(body.title).toBe('Plan from INV-0042')
    expect(body.items.map((i) => i.serviceId)).toEqual(['svc-1', 'svc-2'])
    expect(body.items.map((i) => i.procedureName)).toEqual([
      'Composite filling',
      'Scale and polish',
    ])
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
  })
})

type PlanBody = {
  sourceInvoiceId?: string
  items: Array<{ sourceLineId?: string | null; procedureName: string; estimatedCost: number }>
}
const postedBody = () => (vi.mocked(api.post).mock.calls[0] as [string, PlanBody])[1]

describe('CreateTreatmentPlanSheet — quoted prices (F36, decision D12)', () => {
  it('names the estimate and, for each seeded procedure, the line it came from', async () => {
    vi.mocked(api.get).mockResolvedValue(estimate)
    vi.mocked(api.post).mockResolvedValue({ success: true, data: {} })
    const user = userEvent.setup()
    renderSheet()
    await screen.findByDisplayValue('Composite filling')

    await user.click(screen.getByRole('button', { name: /confirm treatment plan/i }))

    await waitFor(() => expect(api.post).toHaveBeenCalled())
    const body = postedBody()
    expect(body.sourceInvoiceId).toBe('est-1')
    expect(body.items.map((i) => i.sourceLineId)).toEqual(['l1', 'l2'])
    // The quoted totals, in cents, as on the estimate.
    expect(body.items.map((i) => i.estimatedCost)).toEqual([25000, 15000])
  })

  it('shows a quoted price in cedis and does not let it be edited', async () => {
    vi.mocked(api.get).mockResolvedValue(estimate)
    renderSheet()
    await screen.findByDisplayValue('Composite filling')

    const quoted = screen.getByDisplayValue('250.00')
    expect(quoted).toBeDisabled()
    expect(screen.getByDisplayValue('150.00')).toBeDisabled()
    expect(screen.getAllByText(/quoted on the estimate/i).length).toBeGreaterThan(0)
    // The 25000-cent figure is never shown as if it were cedis.
    expect(screen.queryByDisplayValue('25000')).not.toBeInTheDocument()
  })
})

describe('CreateTreatmentPlanSheet — a hand-typed cost is in cedis (F37)', () => {
  it('stores a typed "120" as 120.00 cedis (12000 cents), not 120 cents', async () => {
    vi.mocked(api.get).mockResolvedValue(estimate)
    vi.mocked(api.post).mockResolvedValue({ success: true, data: {} })
    const user = userEvent.setup()
    renderSheet()
    await screen.findByDisplayValue('Composite filling')

    await user.click(screen.getByRole('button', { name: /add procedure/i }))
    const names = screen.getAllByPlaceholderText(/composite filling/i)
    await user.type(names[names.length - 1], 'Night guard')
    const costs = screen.getAllByLabelText(/cost \(ghs\)/i)
    const added = costs[costs.length - 1]
    expect(added).toBeEnabled()
    await user.clear(added)
    await user.type(added, '120')

    // The running total adds it in cedis: 250 + 150 + 120.
    expect(screen.getByText(/520\.00/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /confirm treatment plan/i }))
    await waitFor(() => expect(api.post).toHaveBeenCalled())
    const added3 = postedBody().items[2]
    expect(added3).toMatchObject({ procedureName: 'Night guard', estimatedCost: 12000 })
    expect(added3.sourceLineId ?? null).toBeNull()
  })

  it('a plan with no estimate sends no source, and converts typed cedis to cents', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, data: {} })
    const user = userEvent.setup()
    render(
      <CreateTreatmentPlanSheet
        open
        onOpenChange={() => {}}
        patientId="p-1"
        patientName="Ama Mensah"
        estimateInvoiceId={null}
        onCreated={() => {}}
      />
    )
    await user.type(await screen.findByLabelText(/^title$/i), 'Custom plan')
    await user.click(screen.getByRole('button', { name: /add procedure/i }))
    await user.type(screen.getByPlaceholderText(/composite filling/i), 'Splint')
    const cost = screen.getByLabelText(/cost \(ghs\)/i)
    await user.clear(cost)
    await user.type(cost, '75.50')

    await user.click(screen.getByRole('button', { name: /confirm treatment plan/i }))
    await waitFor(() => expect(api.post).toHaveBeenCalled())
    const body = postedBody()
    expect(body.sourceInvoiceId).toBeUndefined()
    expect(body.items[0]).toMatchObject({ procedureName: 'Splint', estimatedCost: 7550 })
  })
})

describe('CreateTreatmentPlanSheet — when the estimate cannot be loaded', () => {
  it('says so, instead of opening an empty plan with no explanation', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, error: 'Unauthorized' })
    renderSheet()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load the estimate/i)
    expect(alert).toHaveTextContent(/unauthorized/i)
  })

  it('treats a thrown request the same way', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network down'))
    renderSheet()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the estimate/i)
  })

  it('still lets the doctor add procedures by hand', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, error: 'Server error' })
    const user = userEvent.setup()
    renderSheet()
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /add procedure/i }))
    expect(screen.getByPlaceholderText(/composite filling/i)).toBeInTheDocument()
  })

  it('does not report an error for a plain plan with no estimate behind it', async () => {
    render(
      <CreateTreatmentPlanSheet
        open
        onOpenChange={() => {}}
        patientId="p-1"
        patientName="Ama Mensah"
        estimateInvoiceId={null}
        onCreated={() => {}}
      />
    )
    expect(await screen.findByLabelText(/title/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
