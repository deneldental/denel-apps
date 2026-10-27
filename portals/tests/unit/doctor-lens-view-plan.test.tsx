/**
 * F03 — "View Treatment Plan" on the doctor's day-sheet. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 5), decision D4.
 *
 * The button linked to `/clinical/treatment-plans/:id`, a route nothing registers.
 * The catch-all renders outside the app shell, so the doctor landed on a bare
 * "404 — Page Not Found" with no sidebar and no way back. Decision D4: open the
 * existing plan sheet in place, so the day-sheet stays where it is.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/worklist', () => ({
  getDoctorWorklist: vi.fn(),
  routeVisit: vi.fn(),
}))
vi.mock('@/lib/actions/appointments', () => ({ updateAppointment: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
// Neighbouring sheets are not under test.
vi.mock('@/features/activity/components/create-estimate-sheet', () => ({
  CreateEstimateSheet: () => null,
}))
vi.mock('@/features/activity/components/create-treatment-plan-sheet', () => ({
  CreateTreatmentPlanSheet: () => null,
}))
vi.mock('@/features/activity/components/view-estimate-sheet', () => ({
  ViewEstimateSheet: () => null,
}))
vi.mock('@/features/activity/components/cancel-visit-dialog', () => ({
  CancelVisitDialog: () => null,
}))
// The plan sheet is the real, existing component in production; here a probe that
// records what the day-sheet hands it and lets a test close it or report an update.
vi.mock('@/features/clinical/components/clinical-treatment-plan-sheet', () => ({
  ClinicalTreatmentPlanSheet: (props: {
    planId: string
    patient: { id: string; name: string; patientId: string | null }
    open: boolean
    onOpenChange: (open: boolean) => void
    onPlanUpdated?: (planId: string, status: string) => void
  }) =>
    props.open ? (
      <div data-testid="plan-sheet">
        <span>plan:{props.planId}</span>
        <span>patient:{props.patient.id}</span>
        <span>name:{props.patient.name}</span>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          close-sheet
        </button>
        <button type="button" onClick={() => props.onPlanUpdated?.(props.planId, 'accepted')}>
          update-plan
        </button>
      </div>
    ) : null,
}))

import { DoctorLens } from '@/features/activity/components/doctor-lens'
import { getDoctorWorklist } from '@/lib/actions/worklist'
import { renderWithRouter } from './_test-utils'

afterEach(() => vi.resetAllMocks())

function Where() {
  const { pathname } = useLocation()
  return <output data-testid="where">{pathname}</output>
}

const visit = {
  appointmentId: 'a-1',
  patientId: 'p-1',
  patientName: 'Ama Mensah',
  patientPhone: null,
  doctorId: 'd-1',
  doctorName: 'Dr Mensah',
  date: '2026-10-26T09:00:00.000Z',
  status: 'checked_in',
  type: 'consultation',
  requiresEstimate: true,
  estimateStatus: 'invoiced',
  checkedInAt: null,
  hasPendingNote: false,
  estimateInvoiceId: 'inv-1',
  estimateTotal: 40000,
  estimateInvoiceStatus: 'issued',
  treatmentPlanId: 'plan-9',
}

async function renderLens() {
  vi.mocked(getDoctorWorklist).mockResolvedValue({
    success: true,
    data: { date: '2026-10-26', visits: [visit], unlinked: false },
  } as never)
  renderWithRouter(
    <>
      <DoctorLens date="2026-10-26" />
      <Where />
    </>,
    { initialRoute: '/activity' }
  )
  await screen.findByText('Ama Mensah')
}

describe('Doctor day-sheet → View Treatment Plan (D4)', () => {
  it('is a button that opens the plan in place, not a link to a page that does not exist', async () => {
    await renderLens()
    expect(screen.getByRole('button', { name: /view treatment plan/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /view treatment plan/i })).not.toBeInTheDocument()
    for (const a of document.querySelectorAll('a')) {
      expect(a.getAttribute('href') ?? '').not.toContain('/clinical/treatment-plans')
    }
  })

  it('opens the existing plan sheet for that plan and patient, and leaves the day-sheet where it is', async () => {
    const user = userEvent.setup()
    await renderLens()

    await user.click(screen.getByRole('button', { name: /view treatment plan/i }))

    const sheet = await screen.findByTestId('plan-sheet')
    expect(within(sheet).getByText('plan:plan-9')).toBeInTheDocument()
    expect(within(sheet).getByText('patient:p-1')).toBeInTheDocument()
    expect(within(sheet).getByText('name:Ama Mensah')).toBeInTheDocument()
    // Still on the day-sheet, and it is still rendered behind the sheet.
    expect(screen.getByTestId('where')).toHaveTextContent('/activity')
    expect(screen.getByText('Ama Mensah')).toBeInTheDocument()
  })

  it('closing the sheet returns to the day-sheet', async () => {
    const user = userEvent.setup()
    await renderLens()
    await user.click(screen.getByRole('button', { name: /view treatment plan/i }))
    await user.click(await screen.findByRole('button', { name: 'close-sheet' }))

    await waitFor(() => expect(screen.queryByTestId('plan-sheet')).not.toBeInTheDocument())
    expect(screen.getByTestId('where')).toHaveTextContent('/activity')
    expect(screen.getByRole('button', { name: /view treatment plan/i })).toBeInTheDocument()
  })

  it('refreshes the day-sheet when the plan is changed from the sheet', async () => {
    const user = userEvent.setup()
    await renderLens()
    const before = vi.mocked(getDoctorWorklist).mock.calls.length
    await user.click(screen.getByRole('button', { name: /view treatment plan/i }))
    await user.click(await screen.findByRole('button', { name: 'update-plan' }))

    await waitFor(() =>
      expect(vi.mocked(getDoctorWorklist).mock.calls.length).toBeGreaterThan(before)
    )
  })
})
