/**
 * F02 — "View estimate" for a doctor. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 4).
 *
 * The sheet read `/api/invoices/:id`, which needs `payments:read`, so for a doctor
 * the load failed. It then showed "No lines on this estimate", a total of zero and
 * — because the status stayed null — the sentence "This estimate has been confirmed
 * by reception." A failure was displayed as a fact. It now reads the clinical
 * `/api/estimates/:id` and says plainly when it could not load.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import { ViewEstimateSheet } from '@/features/activity/components/view-estimate-sheet'
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

const estimate = (over: Record<string, unknown> = {}) => ({
  success: true as const,
  data: {
    id: 'est-1',
    invoiceNumber: 'INV-0042',
    status: 'draft',
    total: 25000,
    lines: [
      {
        id: 'l1',
        description: 'Scale and polish',
        quantity: 1,
        unitPrice: 25000,
        lineTotal: 25000,
        variantName: null,
      },
    ],
    ...over,
  },
})

const renderSheet = () =>
  render(
    <ViewEstimateSheet
      estimateInvoiceId="est-1"
      patientName="Ama Mensah"
      open
      onOpenChange={() => {}}
    />
  )

describe('ViewEstimateSheet', () => {
  it('reads the clinical estimate endpoint, not the invoice one', async () => {
    vi.mocked(api.get).mockResolvedValue(estimate())
    renderSheet()
    await screen.findByText('Scale and polish')
    expect(api.get).toHaveBeenCalledWith('/api/estimates/est-1')
    for (const [url] of vi.mocked(api.get).mock.calls) {
      expect(String(url)).not.toContain('/api/invoices')
    }
  })

  it('shows a draft estimate with its lines, total and the awaiting-reception line', async () => {
    vi.mocked(api.get).mockResolvedValue(estimate())
    renderSheet()
    expect(await screen.findByText('Scale and polish')).toBeInTheDocument()
    expect(screen.getByText(/INV-0042/)).toBeInTheDocument()
    expect(screen.getByText(/awaiting reception to confirm and take payment/i)).toBeInTheDocument()
    expect(screen.getAllByText(/250\.00/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // Review §8.16: a first-unit / additional-unit line (G01) stores the first unit's price; read as
  // "unit price × quantity" it would not add up to its total.
  it('reads a stepped line as its first unit plus the further units', async () => {
    vi.mocked(api.get).mockResolvedValue(
      estimate({
        total: 22000,
        lines: [
          {
            id: 'l1',
            description: 'Night guard',
            quantity: 3,
            unitPrice: 10000,
            lineSubtotal: 22000,
            lineTotal: 22000,
            variantName: null,
          },
        ],
      })
    )
    renderSheet()

    expect(await screen.findByText('Night guard')).toBeInTheDocument()
    expect(screen.getByText(/100\.00 \+ 2 × .*60\.00/)).toBeInTheDocument()
    expect(screen.queryByText(/100\.00 × 3/)).not.toBeInTheDocument()
  })

  it('says "confirmed by reception" only for an estimate reception has confirmed', async () => {
    vi.mocked(api.get).mockResolvedValue(estimate({ status: 'issued' }))
    renderSheet()
    expect(await screen.findByText(/confirmed by reception/i)).toBeInTheDocument()
  })

  it('says a voided estimate was cancelled, not confirmed', async () => {
    vi.mocked(api.get).mockResolvedValue(estimate({ status: 'void' }))
    renderSheet()
    expect(await screen.findByText(/estimate was cancelled/i)).toBeInTheDocument()
    expect(screen.queryByText(/confirmed by reception/i)).not.toBeInTheDocument()
  })

  it('reports a refused load as a failure — never as "confirmed by reception"', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, error: 'Unauthorized' })
    renderSheet()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load this estimate/i)
    expect(alert).toHaveTextContent(/unauthorized/i)
    // None of the old false statements.
    expect(screen.queryByText(/confirmed by reception/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/no lines on this estimate/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/estimated total/i)).not.toBeInTheDocument()
  })

  it('reports a thrown request as a failure instead of spinning forever', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network down'))
    renderSheet()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load this estimate/i)
  })

  it('offers a retry that loads the estimate', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: false, error: 'Server error' })
      .mockResolvedValueOnce(estimate())
    const user = userEvent.setup()
    renderSheet()

    await user.click(await screen.findByRole('button', { name: /retry/i }))

    expect(await screen.findByText('Scale and polish')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('shows a loaded estimate with no lines as empty, which is not a failure', async () => {
    vi.mocked(api.get).mockResolvedValue(estimate({ lines: [], total: 0 }))
    renderSheet()
    expect(await screen.findByText(/no lines on this estimate/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
