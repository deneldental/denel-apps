/**
 * Pins the fix for the Medium finding "Two silent-empty states in the
 * patient add/edit forms" (project-docs/patient-records-and-scheduling-audit.md):
 * the Tags section disappeared entirely with no configured tags, with no
 * "add one in Settings" message.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TagPicker } from '@/features/patients/components/tag-picker'
import { renderWithRouter } from './_test-utils'

vi.mock('@/shared/hooks/use-patient-tag-catalog', () => ({
  usePatientTagCatalog: vi.fn(),
}))

import { usePatientTagCatalog } from '@/shared/hooks/use-patient-tag-catalog'

const mockUsePatientTagCatalog = vi.mocked(usePatientTagCatalog)

describe('TagPicker empty state [Medium]', () => {
  it('renders nothing while the catalog is still loading', () => {
    mockUsePatientTagCatalog.mockReturnValue({ catalog: [], isLoading: true, error: null })
    const { container } = renderWithRouter(<TagPicker value={[]} onChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('explains the empty state once loaded with zero tags configured, instead of vanishing', () => {
    mockUsePatientTagCatalog.mockReturnValue({ catalog: [], isLoading: false, error: null })
    renderWithRouter(<TagPicker value={[]} onChange={() => {}} />)
    expect(screen.getByText('Tags')).toBeInTheDocument()
    expect(screen.getByText(/no tags configured yet/i)).toBeInTheDocument()
  })

  it('still renders the chips when tags exist', () => {
    mockUsePatientTagCatalog.mockReturnValue({
      catalog: [{ id: 't-1', name: 'VIP', color: 'blue', isActive: true, systemKey: null }],
      isLoading: false,
      error: null,
    })
    renderWithRouter(<TagPicker value={[]} onChange={() => {}} />)
    expect(screen.getByText('VIP')).toBeInTheDocument()
    expect(screen.queryByText(/no tags configured yet/i)).not.toBeInTheDocument()
  })
})
