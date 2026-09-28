/**
 * settings-domain-audit B5 (worst case): after a failed load this section
 * held `{}`, and a single toggle wrote `{ [id]: value }` over the stored map —
 * un-hiding every other module. Toggles must be inert until the map loaded.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { ModuleVisibilitySection } from '@/features/settings/components/module-visibility-section'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const mockApiGet = vi.mocked(api.get)
const mockApiPut = vi.mocked(api.put)

describe('ModuleVisibilitySection', () => {
  beforeEach(() => {
    mockApiPut.mockResolvedValue({ success: true })
  })
  afterEach(() => vi.clearAllMocks())

  it('writes the whole map, keeping the other modules as stored', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: { labs: false, xrays: false } })
    renderWithRouter(<ModuleVisibilitySection />)
    const insurance = screen.getByRole('switch', { name: /insurance/i })
    await waitFor(() => expect(insurance).not.toBeDisabled())
    expect(screen.getByRole('switch', { name: /^labs$/i })).not.toBeChecked()

    fireEvent.click(insurance)
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(mockApiPut).toHaveBeenCalledWith('/api/settings/kv/module_visibility', {
      value: { labs: false, xrays: false, insurance: false },
    })
  })

  it('keeps every toggle disabled and writes nothing when the map failed to load', async () => {
    mockApiGet.mockResolvedValue({ success: false, error: 'Network error' })
    renderWithRouter(<ModuleVisibilitySection />)
    expect(await screen.findByText(/couldn.t load these settings/i)).toBeInTheDocument()

    for (const s of screen.getAllByRole('switch')) expect(s).toBeDisabled()
    fireEvent.click(screen.getByRole('switch', { name: /insurance/i }))
    expect(mockApiPut).not.toHaveBeenCalled()
  })
})
