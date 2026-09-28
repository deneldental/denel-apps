/**
 * settings-domain-audit S5-B (clinical): the odontogram prints tooth numbers
 * in the notation chosen in Settings → Clinical → Charting Preferences while
 * storing FDI.
 */
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { OdontogramChart } from '@/features/odontogram/components/odontogram-chart'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const mockApiGet = vi.mocked(api.get)

function mockNotation(notationSystem: string | null) {
  mockApiGet.mockImplementation(async (path: string) => {
    if (path.includes('clinical:charting_preferences'))
      return { success: true, data: notationSystem ? { notationSystem } : null }
    if (path.includes('clinical:perio_thresholds')) return { success: true, data: null }
    return { success: true, data: [] }
  })
}

describe('OdontogramChart notation', () => {
  afterEach(() => vi.clearAllMocks())

  it('labels teeth in Palmer notation when configured', async () => {
    mockNotation('palmer')
    renderWithRouter(<OdontogramChart patientId="p-1" />)
    expect(await screen.findByTitle('Tooth UR6')).toBeInTheDocument()
    expect(screen.queryByTitle('Tooth 16')).toBeNull()
    expect(await screen.findByText(/palmer notation/i)).toBeInTheDocument()
  })

  it('defaults to FDI', async () => {
    mockNotation(null)
    renderWithRouter(<OdontogramChart patientId="p-1" />)
    expect(await screen.findByTitle('Tooth 16')).toBeInTheDocument()
  })
})
