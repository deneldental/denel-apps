/**
 * settings-domain-audit B7 (client half) for the generic lookup section that
 * backs nine clinical lookups plus compliance tags: editing must send the
 * new display name only — the slug is set at creation and is what every
 * case-stage snapshot references.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { ClinicalLookupSection } from '@/features/settings/components/clinical-lookup-section'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const mockApiGet = vi.mocked(api.get)
const mockApiPost = vi.mocked(api.post)
const mockApiPatch = vi.mocked(api.patch)

const PAIN = { id: 'pc-1', name: 'tooth_pain', displayName: 'Tooth Pain', isActive: true }

function renderSection() {
  return renderWithRouter(
    <ClinicalLookupSection
      type="presenting-complaints"
      title="Presenting Complaints"
      description="Options shown in the Presenting Complaint stage."
      noun="Complaint"
    />
  )
}

describe('ClinicalLookupSection', () => {
  beforeEach(() => {
    mockApiGet.mockResolvedValue({ success: true, data: [PAIN] })
    mockApiPost.mockResolvedValue({ success: true })
    mockApiPatch.mockResolvedValue({ success: true })
  })
  afterEach(() => vi.clearAllMocks())

  it('creates with a slug derived from the display name', async () => {
    renderSection()
    await screen.findByText('Tooth Pain')
    fireEvent.click(screen.getByRole('button', { name: /add complaint/i }))
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: 'Bleeding Gums / Gingivitis' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1))
    expect(mockApiPost).toHaveBeenCalledWith('/api/lookups/presenting-complaints', {
      name: 'bleeding_gums_gingivitis',
      displayName: 'Bleeding Gums / Gingivitis',
    })
  })

  it('edits the display name without touching the slug', async () => {
    renderSection()
    const row = (await screen.findByText('Tooth Pain')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getAllByRole('button')[0])

    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: 'Toothache' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^update$/i }))

    await waitFor(() => expect(mockApiPatch).toHaveBeenCalledTimes(1))
    expect(mockApiPatch).toHaveBeenCalledWith('/api/lookups/presenting-complaints/pc-1', {
      displayName: 'Toothache',
    })
  })
})
