/**
 * Unit tests for AccessManagementOverviewPage.
 *
 * Covers:
 *  - Initial render: "Find someone" search card is shown
 *  - Staff list loaded from API and rendered
 *  - Search filters staff by name/email/role (client-side)
 *  - "No staff match" shown when search yields nothing
 *  - "Bulk role assign" and "Who can do X?" cards render
 *  - BulkRoleSheet opens on button click
 *  - WhoCanDoSheet opens on button click
 *  - API failure is handled gracefully (no crash, list stays empty)
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/lib/actions/access-management', () => ({
  bulkAssignRole: vi.fn(),
  whoCanDo: vi.fn(),
  offboardStaff: vi.fn(),
  getUserPermissions: vi.fn(),
  listPatientPwa: vi.fn(),
  listPatientSessions: vi.fn(),
  revokePatientPwa: vi.fn(),
  revokePatientSessions: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/features/staff/__mock__/team-members', () => ({
  TEAM_ROLE_OPTIONS: [
    { value: 'doctor', label: 'Doctor' },
    { value: 'receptionist', label: 'Receptionist' },
    { value: 'admin', label: 'Admin' },
  ],
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import AccessManagementOverviewPage from '@/features/access-management/pages/index'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const mockApiGet = vi.mocked(api.get)

// ── Fixtures ──────────────────────────────────────────────────────────────────

const STAFF_LIST = [
  {
    id: 'u-1',
    staffRecordId: 'staff-1',
    name: 'Ama Asante',
    email: 'ama@framada.app',
    role: 'doctor',
    staffType: 'full_time',
  },
  {
    id: 'u-2',
    staffRecordId: 'staff-2',
    name: 'Kofi Mensah',
    email: 'kofi@framada.app',
    role: 'receptionist',
    staffType: 'full_time',
  },
  {
    id: 'u-3',
    staffRecordId: null,
    name: 'External Trainer',
    email: 'trainer@framada.app',
    role: 'external_trainer',
    staffType: null,
  },
]

function renderPage() {
  return renderWithRouter(<AccessManagementOverviewPage />)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AccessManagementOverviewPage — initial render', () => {
  beforeEach(() => {
    mockApiGet.mockResolvedValue({ success: true, data: { staff: STAFF_LIST } })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the "Find someone" card with search input', () => {
    renderPage()
    expect(screen.getByText(/find someone/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/search by name, email, or role/i)).toBeInTheDocument()
  })

  it('renders the "Bulk role assign" action card', () => {
    renderPage()
    expect(screen.getByText(/bulk role assign/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open bulk assigner/i })).toBeInTheDocument()
  })

  it('renders the "Who can do X?" action card', () => {
    renderPage()
    expect(screen.getByText(/who can do x/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run audit/i })).toBeInTheDocument()
  })

  it('fetches staff from /api/access-management on mount', async () => {
    renderPage()
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/access-management')
    })
  })
})

describe('AccessManagementOverviewPage — staff list rendering', () => {
  beforeEach(() => {
    mockApiGet.mockResolvedValue({ success: true, data: { staff: STAFF_LIST } })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders loaded staff names in the list', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Ama Asante')).toBeInTheDocument()
      expect(screen.getByText('Kofi Mensah')).toBeInTheDocument()
    })
  })

  it('renders staff emails', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('ama@framada.app')).toBeInTheDocument()
    })
  })

  it('renders role badges for staff with roles', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('doctor')).toBeInTheDocument()
      expect(screen.getByText('receptionist')).toBeInTheDocument()
    })
  })

  it('staff with staffRecordId links to /hr/:id?tab=permissions', async () => {
    renderPage()
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /ama asante/i })
      expect(link).toHaveAttribute('href', '/hr/staff-1?tab=permissions')
    })
  })

  it('staff without staffRecordId links to /hr/staff fallback', async () => {
    renderPage()
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /external trainer/i })
      expect(link).toHaveAttribute('href', '/hr/staff')
    })
  })
})

describe('AccessManagementOverviewPage — search filtering', () => {
  beforeEach(() => {
    mockApiGet.mockResolvedValue({ success: true, data: { staff: STAFF_LIST } })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('filters staff by name when typing in search', async () => {
    renderPage()
    // Wait until all 3 staff members appear as /hr/ links in the search results.
    // BulkRoleSheet uses <p> tags (not links) so /hr/ links are unique to results.
    await waitFor(() => {
      const hrLinks = screen
        .getAllByRole('link')
        .filter((l) => (l.getAttribute('href') ?? '').startsWith('/hr/'))
      expect(hrLinks).toHaveLength(3)
    })

    // Use the full name — "ama" alone matches all 3 staff via the shared
    // "@framada.app" domain ("framada" contains "ama").
    fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
      target: { value: 'ama asante' },
    })

    // After filtering "ama asante", only Ama Asante's /hr/ link should remain
    await waitFor(() => {
      const hrLinks = screen
        .getAllByRole('link')
        .filter((l) => (l.getAttribute('href') ?? '').startsWith('/hr/'))
      expect(hrLinks).toHaveLength(1)
      expect(hrLinks[0].getAttribute('href')).toBe('/hr/staff-1?tab=permissions')
    })
  })

  it('filters staff by email', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /kofi mensah/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /ama asante/i })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
      target: { value: 'kofi@' },
    })

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /ama asante/i })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /kofi mensah/i })).toBeInTheDocument()
  })

  it('filters staff by role', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /ama asante/i })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
      target: { value: 'external_trainer' },
    })

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /ama asante/i })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /external trainer/i })).toBeInTheDocument()
  })

  it('shows "No staff match" when search has no results', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Ama Asante'))

    fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
      target: { value: 'zzz-nobody-zzz' },
    })

    expect(screen.getByText(/no staff match/i)).toBeInTheDocument()
  })

  it('shows all staff (up to 8) when search is cleared', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Ama Asante'))

    const input = screen.getByPlaceholderText(/search by name/i)
    fireEvent.change(input, { target: { value: 'ama' } })
    fireEvent.change(input, { target: { value: '' } })

    expect(screen.getByText('Ama Asante')).toBeInTheDocument()
    expect(screen.getByText('Kofi Mensah')).toBeInTheDocument()
  })
})

describe('AccessManagementOverviewPage — sheet interactions', () => {
  beforeEach(() => {
    mockApiGet.mockResolvedValue({ success: true, data: { staff: STAFF_LIST } })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('opens BulkRoleSheet when "Open bulk assigner" is clicked', async () => {
    renderPage()
    // Before click: no open dialog
    expect(document.querySelector('[data-state="open"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /open bulk assigner/i }))

    // After click: Radix marks the dialog as open via data-state
    await waitFor(() => {
      expect(document.querySelector('[data-state="open"]')).not.toBeNull()
    })
  })

  it('opens WhoCanDoSheet when "Run audit" is clicked', async () => {
    renderPage()
    // Before click: no open dialog
    expect(document.querySelector('[data-state="open"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /run audit/i }))

    // After click: Radix marks the sheet dialog as open
    await waitFor(() => {
      expect(document.querySelector('[data-state="open"]')).not.toBeNull()
    })
  })
})

describe('AccessManagementOverviewPage — API failure handling', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing when API returns failure', async () => {
    mockApiGet.mockResolvedValue({ success: false, error: 'Unauthorized' })
    renderPage()
    // Must not crash; search card stays visible
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search by name/i)).toBeInTheDocument()
    })
  })

  it('component does not crash and shows a toast when api.get() rejects', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'))
    renderPage()
    // Component must stay mounted — search card remains visible
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search by name/i)).toBeInTheDocument()
    })
    // toast.error must have been called (not the raw error text on screen).
    // Its own waitFor: the rejection reaches the component's effect on a
    // later render than the one the search-card assertion above settles on.
    const { toast } = await import('sonner')
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })
  })

  it('shows empty state when API returns empty staff list', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: { staff: [] } })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/no staff match/i)).toBeInTheDocument()
    })
  })
})
