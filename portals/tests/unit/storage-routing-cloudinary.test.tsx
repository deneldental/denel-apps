/**
 * Integrations → Storage routing. Every file category stores private files,
 * and Cloudinary cannot keep files private — routing a category to it would
 * make every upload there fail. The card must not offer that trap.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { StorageRoutingCard } from '@/features/integrations/components/storage-routing-card'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

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

const response = (patientRecords: string) => ({
  success: true,
  data: {
    routing: { patient_records: patientRecords, staff: 'r2', system_docs: 'r2', misc: 'r2' },
    providers: [
      { id: 'r2', label: 'Cloudflare R2', configured: true },
      { id: 'do_spaces', label: 'DigitalOcean Spaces', configured: true },
      { id: 'cloudinary', label: 'Cloudinary', configured: true },
    ],
  },
})

beforeEach(() => vi.mocked(api.get).mockResolvedValue(response('r2')))
afterEach(() => vi.clearAllMocks())

describe('Storage routing and Cloudinary', () => {
  it('does not let a category be routed to Cloudinary, even when configured', async () => {
    const user = userEvent.setup()
    renderWithRouter(<StorageRoutingCard />)
    await waitFor(() => expect(screen.getAllByRole('combobox')[0]).toBeEnabled())

    await user.click(screen.getAllByRole('combobox')[0])
    const option = await screen.findByRole('option', { name: /cloudinary/i })

    expect(option).toHaveAttribute('data-disabled')
    expect(option.textContent).toMatch(/can't store private files/i)
  })

  it('warns when a saved routing still points at Cloudinary', async () => {
    vi.mocked(api.get).mockResolvedValue(response('cloudinary'))
    renderWithRouter(<StorageRoutingCard />)

    expect(
      await screen.findByText(/Patient Records .*Cloudinary.*can't store private files/i)
    ).toBeInTheDocument()
  })
})
