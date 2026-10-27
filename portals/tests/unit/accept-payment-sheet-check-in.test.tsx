/**
 * F11 — the Accept Payment sheet passes the visit it is for down to whichever
 * payment form is chosen, and passes the form's result back up.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F11).
 *
 * The sheet received only the patient id, so no payment taken at check-in named
 * its visit, and the cancelled-visit protection in the ledger had nothing to check.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The props the stubbed payment sheets and dialogs are given, as the tests use them. */
type StubProps = {
  open?: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (info?: { checkedIn?: boolean }) => void
  onNoPayment?: () => void
  onCheckedIn?: () => void
  [key: string]: unknown
}

const seen = vi.hoisted(() => ({
  oneTime: null as null | StubProps,
  plan: null as null | StubProps,
  insurance: null as null | StubProps,
}))

vi.mock('@/features/payments/components/accept-payment-card-grid', () => ({
  AcceptPaymentCardGrid: ({ onSelect }: { onSelect: (t: string) => void }) => (
    <div>
      <button type="button" onClick={() => onSelect('one-time')}>
        pick one-time
      </button>
      <button type="button" onClick={() => onSelect('plan')}>
        pick plan
      </button>
      <button type="button" onClick={() => onSelect('insurance')}>
        pick insurance
      </button>
    </div>
  ),
}))
vi.mock('@/features/payments/components/one-time-payment-sheet', () => ({
  OneTimePaymentSheet: (props: StubProps) => {
    seen.oneTime = props
    return (
      <button type="button" onClick={() => props.onSuccess?.({ checkedIn: true })}>
        one-time form
      </button>
    )
  },
}))
vi.mock('@/features/payments/components/plan-payment-sheet', () => ({
  PlanPaymentSheet: (props: StubProps) => {
    seen.plan = props
    return (
      <button type="button" onClick={() => props.onSuccess?.()}>
        plan form
      </button>
    )
  },
}))
vi.mock('@/features/payments/components/insurance-claim-sheet', () => ({
  InsuranceClaimSheet: (props: StubProps) => {
    seen.insurance = props
    return (
      <button type="button" onClick={() => props.onSuccess?.()}>
        insurance form
      </button>
    )
  },
}))

import { AcceptPaymentSheet } from '@/features/payments/components/accept-payment-sheet'

afterEach(() => {
  seen.oneTime = seen.plan = seen.insurance = null
  vi.clearAllMocks()
})

function mount(extra: Record<string, unknown> = {}) {
  const onSuccess = vi.fn()
  render(
    <AcceptPaymentSheet
      open
      onOpenChange={() => {}}
      onSuccess={onSuccess}
      presetPatientId="pat-1"
      {...extra}
    />
  )
  return { onSuccess }
}

describe('the visit id reaches the payment forms (F11)', () => {
  it('one-time payment gets the appointment id', () => {
    mount({ appointmentId: 'appt-1' })
    fireEvent.click(screen.getByText('pick one-time'))
    expect(seen.oneTime).toMatchObject({ appointmentId: 'appt-1', presetPatientId: 'pat-1' })
  })

  it('a plan payment gets the appointment id', () => {
    mount({ appointmentId: 'appt-1' })
    fireEvent.click(screen.getByText('pick plan'))
    expect(seen.plan).toMatchObject({ appointmentId: 'appt-1', presetPatientId: 'pat-1' })
  })

  it('without a visit, none is passed (the sheet is also used outside check-in)', () => {
    mount()
    fireEvent.click(screen.getByText('pick one-time'))
    expect(seen.oneTime?.appointmentId).toBeUndefined()
  })
})

describe('what each form reports comes back up', () => {
  it('a one-time payment taken by the check-in request says the patient is checked in', () => {
    const { onSuccess } = mount({ appointmentId: 'appt-1' })
    fireEvent.click(screen.getByText('pick one-time'))
    fireEvent.click(screen.getByText('one-time form'))

    expect(onSuccess).toHaveBeenCalledWith({ checkedIn: true })
  })

  it.each([
    ['plan', 'pick plan', 'plan form'],
    ['insurance', 'pick insurance', 'insurance form'],
  ])('a %s payment reports success without claiming a check-in', (_n, pick, form) => {
    const { onSuccess } = mount({ appointmentId: 'appt-1' })
    fireEvent.click(screen.getByText(pick))
    fireEvent.click(screen.getByText(form))

    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess.mock.calls[0][0]?.checkedIn).toBeFalsy()
  })
})

// F33 — a walk-in's visit is NAMED on the payment but never checked in (it already is).
describe('a walk-in visit reaches the forms as a link, not a check-in (F33)', () => {
  it('a one-time payment gets the visit to name, and no check-in visit', () => {
    mount({ linkAppointmentId: 'walk-1' })
    fireEvent.click(screen.getByText('pick one-time'))
    expect(seen.oneTime).toMatchObject({ linkAppointmentId: 'walk-1', presetPatientId: 'pat-1' })
    expect(seen.oneTime?.appointmentId).toBeUndefined()
  })

  it('a plan payment names the visit (the plan form only ever names it)', () => {
    mount({ linkAppointmentId: 'walk-1' })
    fireEvent.click(screen.getByText('pick plan'))
    expect(seen.plan).toMatchObject({ appointmentId: 'walk-1', presetPatientId: 'pat-1' })
  })
})
