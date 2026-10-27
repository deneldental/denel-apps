/**
 * The Payments page's Overdue and Outstanding tabs (F05, minor) — see
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.11).
 *
 * Both tabs called `/api/payment-plans/overdue`, which answers with overdue AND outstanding plans,
 * so the two tabs showed the same list. Now the Overdue tab asks for overdue plans only and the
 * Outstanding tab has its own route. The dashboard and the reminders page, which want both kinds,
 * keep calling the action without a filter.
 */
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PaymentsPage from '@/features/payments/pages'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn() } }))
vi.mock('@/lib/actions/payments', () => ({ getPayments: vi.fn() }))
vi.mock('@/features/payments/components/payments-content', () => ({
  PaymentsContent: (props: {
    overduePlans: { id: string }[]
    outstandingPlans: { id: string }[]
  }) => (
    <div>
      <span data-testid="overdue">{props.overduePlans.map((p) => p.id).join(',')}</span>
      <span data-testid="outstanding">{props.outstandingPlans.map((p) => p.id).join(',')}</span>
    </div>
  ),
}))

import {
  getOutstandingPaymentPlans,
  getOverduePaymentPlans,
  getPaymentPlanDetails,
} from '@/lib/actions/payment-plans'
import { getPayments } from '@/lib/actions/payments'
import { api } from '@/lib/api-client'

const get = vi.mocked(api.get)

beforeEach(() => {
  vi.resetAllMocks()
  get.mockResolvedValue({ success: true, data: [] } as never)
})

describe('plan list actions', () => {
  it('asks for overdue and outstanding plans together when no kind is given', async () => {
    await getOverduePaymentPlans()
    expect(get).toHaveBeenCalledWith('/api/payment-plans/overdue')
  })

  it('asks for one kind when it is given', async () => {
    await getOverduePaymentPlans('overdue')
    expect(get).toHaveBeenCalledWith('/api/payment-plans/overdue?status=overdue')
  })

  it('has its own route for outstanding plans', async () => {
    await getOutstandingPaymentPlans()
    expect(get).toHaveBeenCalledWith('/api/payment-plans/outstanding')
  })

  it('reads one plan from its own address', async () => {
    await getPaymentPlanDetails('plan-9')
    expect(get).toHaveBeenCalledWith('/api/payment-plans/plan-9')
  })

  it('returns what the server returned for a plan, including a failure', async () => {
    get.mockResolvedValue({ success: false, error: 'Payment plan not found' } as never)
    expect(await getPaymentPlanDetails('x')).toEqual({
      success: false,
      error: 'Payment plan not found',
    })
  })
})

describe('the Payments page', () => {
  it('gives the Overdue tab overdue plans and the Outstanding tab outstanding plans', async () => {
    vi.mocked(getPayments).mockResolvedValue({ success: true, data: [] } as never)
    get.mockImplementation((async (path: string) => {
      if (path === '/api/payment-plans') return { success: true, data: [] }
      if (path === '/api/payment-plans/overdue?status=overdue')
        return { success: true, data: [{ id: 'late-plan' }] }
      if (path === '/api/payment-plans/outstanding')
        return { success: true, data: [{ id: 'cancelled-plan' }] }
      return { success: true, data: [] }
    }) as never)

    renderWithRouter(<PaymentsPage />)

    await waitFor(() => expect(screen.getByTestId('overdue')).toHaveTextContent('late-plan'))
    expect(screen.getByTestId('overdue')).not.toHaveTextContent('cancelled-plan')
    expect(screen.getByTestId('outstanding')).toHaveTextContent('cancelled-plan')
    expect(screen.getByTestId('outstanding')).not.toHaveTextContent('late-plan')
  })
})
