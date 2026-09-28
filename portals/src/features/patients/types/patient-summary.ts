// Contract for `GET /api/patients/:id/summary` — the aggregate that backs the
// patient-detail bio pane.
//
// These types started life in `features/patients/__mock__/patient-detail.ts` as
// the intended contract for a backend that did not exist yet. The endpoint now
// exists (`backend/src/routes/patients.ts`), so the declarations moved here and
// the mock was deleted. The original fields are preserved verbatim; the only
// changes are additive, and each is required by what the pane actually renders:
//
//  - `paymentPlans` — the pane renders *every* live plan as its own card, not
//    just one. `paymentPlan` is kept as the primary (most recently created)
//    plan so the original single-plan contract still holds.
//  - `'overdue'` on the status union — a real `payment_plans.status` value the
//    pane already styles distinctly (red). Dropping it would be a regression.

export interface PatientPaymentPlanSummary {
  id: string
  templateName: string | null
  /** Fixed = regular schedule w/ set installments. Flexible = pay-as-you-go. */
  planType: 'fixed' | 'flexible'
  totalAmount: number
  amountPerInstallment: number | null
  paymentFrequency: 'weekly' | 'biweekly' | 'monthly' | 'custom' | null
  status: 'activated' | 'outstanding' | 'paused' | 'completed' | 'overdue'
  /** e.g. "2 of 6" installments paid. */
  installmentsPaid: number
  installmentsTotal: number
  /** Next installment due date (`YYYY-MM-DD`). */
  nextDueAt: string | null
}

export interface PatientSummary {
  outstandingBalance: number
  /** Primary (most recently created) live plan, or null when there is none. */
  paymentPlan: PatientPaymentPlanSummary | null
  /** Every live plan — `activated`, `overdue` or `paused`, non-archived. */
  paymentPlans: PatientPaymentPlanSummary[]
}
