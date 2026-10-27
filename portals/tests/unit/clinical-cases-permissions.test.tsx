/**
 * F04 — the Clinical page's Cases tab offers only what the server will do.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 4), decision D3.
 *
 * The page rendered `<ClinicalCasesTab canEdit isAdmin />` for everyone, so a doctor
 * got a "New case" button the server refused (403) and an "Archive case" menu the
 * server also refused. Opening a case now follows `medical_records:create` (which a
 * doctor holds) and archiving follows `patients:delete`.
 */
import { screen } from '@testing-library/react'
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
// The other tabs are not under test and fetch their own data.
vi.mock('@/features/clinical/components/clinical-treatments-tab', () => ({
  ClinicalTreatmentsTab: () => null,
}))
vi.mock('@/features/clinical/components/clinical-prescriptions-tab', () => ({
  ClinicalPrescriptionsTab: () => null,
}))

import { ClinicalPage } from '@/features/clinical/pages/clinical-page'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const CASE = {
  id: 'case-1',
  caseNumber: 'CASE-0001',
  status: 'open',
  chiefComplaint: 'Toothache',
  createdAt: '2026-10-20T09:00:00.000Z',
  closedAt: null,
  patient: { id: 'p-1', name: 'Ama Mensah', patientId: 'DD-0001' },
  createdBy: { id: 'u-1', name: 'Dr Mensah' },
  plan: null,
}

beforeEach(() => {
  perms.held = new Set()
  perms.admin = false
  vi.mocked(api.get).mockResolvedValue({ success: true, data: [CASE] })
})
afterEach(() => vi.resetAllMocks())

async function renderPage() {
  renderWithRouter(<ClinicalPage />, { initialRoute: '/clinical/cases' })
  await screen.findByText('CASE-0001')
}

describe('Clinical → Cases: what each role is offered', () => {
  it('a doctor can open a case, and cannot archive one', async () => {
    perms.held = new Set(['patients:read', 'patients:update', 'medical_records:create'])
    await renderPage()
    expect(screen.getByRole('button', { name: /new case/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more options/i })).not.toBeInTheDocument()
  })

  it('someone who may archive (patients:delete) gets the row menu', async () => {
    perms.held = new Set(['medical_records:create', 'patients:delete'])
    await renderPage()
    expect(screen.getByRole('button', { name: /new case/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument()
  })

  it('an admin gets both', async () => {
    perms.admin = true
    await renderPage()
    expect(screen.getByRole('button', { name: /new case/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument()
  })

  it('a read-only user gets neither, though the page lets them look', async () => {
    perms.held = new Set(['patients:read', 'medical_records:read'])
    await renderPage()
    expect(screen.queryByRole('button', { name: /new case/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more options/i })).not.toBeInTheDocument()
  })

  it('does not treat patients:create as the right to open a case', async () => {
    // The old server rule. Registering a patient is not clinical work.
    perms.held = new Set(['patients:create'])
    await renderPage()
    expect(screen.queryByRole('button', { name: /new case/i })).not.toBeInTheDocument()
  })
})
