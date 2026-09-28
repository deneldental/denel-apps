/**
 * settings-domain-audit B7 (client half): the edit dialog regenerated the
 * slug (`name`) from the display name on every save, so relabelling "Box" as
 * "Boxes" silently renamed the slug every item's `unit` column points at.
 * Editing must send the new label only; the slug is set at creation.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/units', () => ({
  getAllUnits: vi.fn(),
  createUnit: vi.fn(),
  updateUnit: vi.fn(),
  deleteUnit: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { UnitsSection } from '@/features/settings/components/units-section'
import { createUnit, getAllUnits, updateUnit } from '@/lib/actions/units'
import { renderWithRouter } from './_test-utils'

const mockGetAllUnits = vi.mocked(getAllUnits)
const mockCreateUnit = vi.mocked(createUnit)
const mockUpdateUnit = vi.mocked(updateUnit)

const BOX = { id: 'u-1', name: 'box', displayName: 'Box', colour: null, isActive: true }

describe('UnitsSection', () => {
  beforeEach(() => {
    mockGetAllUnits.mockResolvedValue({ success: true, data: [BOX] })
    mockCreateUnit.mockResolvedValue({ success: true })
    mockUpdateUnit.mockResolvedValue({ success: true })
  })
  afterEach(() => vi.clearAllMocks())

  it('creates a unit with a slug derived from the display name', async () => {
    renderWithRouter(<UnitsSection />)
    await screen.findByText('Box')
    fireEvent.click(screen.getByRole('button', { name: /add unit/i }))
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: 'Pieces (pcs)' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(mockCreateUnit).toHaveBeenCalledTimes(1))
    expect(mockCreateUnit).toHaveBeenCalledWith({ name: 'pieces_pcs', displayName: 'Pieces (pcs)' })
  })

  it('edits the display name without touching the slug', async () => {
    renderWithRouter(<UnitsSection />)
    const row = (await screen.findByText('Box')).closest('tr') as HTMLElement
    // First action button in the row is Edit (pencil), second is Delete.
    fireEvent.click(within(row).getAllByRole('button')[0])

    const input = screen.getByLabelText(/display name/i) as HTMLInputElement
    expect(input.value).toBe('Box')
    fireEvent.change(input, { target: { value: 'Boxes' } })
    fireEvent.click(screen.getByRole('button', { name: /^update$/i }))

    await waitFor(() => expect(mockUpdateUnit).toHaveBeenCalledTimes(1))
    const [id, data] = mockUpdateUnit.mock.calls[0] as [string, Record<string, unknown>]
    expect(id).toBe('u-1')
    expect(data).toEqual({ displayName: 'Boxes' })
    expect(data).not.toHaveProperty('name')
  })
})
