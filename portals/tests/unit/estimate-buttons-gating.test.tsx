/**
 * F38 — the remaining "create an estimate" buttons follow `estimates:create`. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md.
 *
 * Clinical → Estimates & Plans "New Estimate" and the plan sheet's "Create
 * Supplemental Estimate" were shown to everyone who could open those screens. A user
 * without `estimates:create` (a custom role with Clinical access, say) got a button
 * the server refuses. They now ask the same permission the server enforces.
 */
import { screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/features/clinical/use-clinical-preferences', () => ({
  useToothNotation: () => ({ toothLabel: (n: number) => String(n) }),
}))
// The builder itself is not under test.
vi.mock('@/features/activity/components/create-estimate-sheet', () => ({
  CreateEstimateSheet: () => null,
}))

import { ClinicalTreatmentPlanSheet } from '@/features/clinical/components/clinical-treatment-plan-sheet'
import { ClinicalTreatmentsTab } from '@/features/clinical/components/clinical-treatments-tab'
import { api } from '@/lib/api-client'
import { type PermissionsPayload, PermissionsProvider } from '@/lib/permissions-context'
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
afterEach(() => vi.resetAllMocks())

const payload = (permissions: Record<string, string[]>, isAdmin = false): PermissionsPayload => ({
  isAdmin,
  scopes: ['portal'],
  accessibleModules: Object.keys(permissions),
  permissions,
})
const CLINICAL = { medical_records: ['read', 'create', 'update'], patients: ['read'] }

const PLAN = {
  id: 'plan-1',
  title: 'Plan from INV-0042',
  status: 'created',
  totalEstimated: 40000,
  createdAt: '2026-10-20T09:00:00.000Z',
  notes: null,
  patientId: 'p-1',
  items: [],
  caseId: 'case-1',
  caseNumber: 'CASE-0001',
}

function renderTab(p: PermissionsPayload) {
  vi.mocked(api.get).mockResolvedValue({ success: true, data: [] })
  renderWithRouter(
    <PermissionsProvider value={p}>
      <ClinicalTreatmentsTab />
    </PermissionsProvider>,
    { initialRoute: '/clinical/treatments' }
  )
}

function renderPlanSheet(p: PermissionsPayload) {
  vi.mocked(api.get).mockResolvedValue({ success: true, data: PLAN })
  renderWithRouter(
    <PermissionsProvider value={p}>
      <ClinicalTreatmentPlanSheet
        planId="plan-1"
        patient={{ id: 'p-1', name: 'Ama Mensah', patientId: null }}
        open
        onOpenChange={() => {}}
      />
    </PermissionsProvider>
  )
}

describe('Clinical → Estimates & Plans "New Estimate"', () => {
  it('is offered to someone who holds estimates:create (a doctor)', async () => {
    renderTab(payload({ ...CLINICAL, estimates: ['read', 'create', 'update'] }))
    expect(await screen.findByRole('button', { name: /new estimate/i })).toBeInTheDocument()
  })

  it('is not offered without estimates:create', async () => {
    renderTab(payload({ ...CLINICAL, estimates: ['read'] }))
    // Wait for the list to settle, so absence is not just "not rendered yet".
    await screen.findByText(/no estimates found/i)
    expect(screen.queryByRole('button', { name: /new estimate/i })).not.toBeInTheDocument()
  })

  it('is offered to an admin', async () => {
    renderTab(payload({}, true))
    expect(await screen.findByRole('button', { name: /new estimate/i })).toBeInTheDocument()
  })
})

describe('Plan sheet "Create Supplemental Estimate"', () => {
  it('is offered to someone who holds estimates:create', async () => {
    renderPlanSheet(payload({ ...CLINICAL, estimates: ['read', 'create'] }))
    expect(
      await screen.findByRole('button', { name: /create supplemental estimate/i })
    ).toBeInTheDocument()
  })

  it('is not offered without estimates:create', async () => {
    renderPlanSheet(payload({ ...CLINICAL }))
    await screen.findAllByText(/CASE-0001/)
    expect(
      screen.queryByRole('button', { name: /create supplemental estimate/i })
    ).not.toBeInTheDocument()
  })
})
