/**
 * Lifecycle task templates.
 *
 * When a staff record is created we instantiate the matching template
 * (onboarding for new hires, offboarding when status flips to inactive,
 * probation_review at ~80% through probation, contract_renewal at ~30
 * days before contractEndDate).
 *
 * Template definitions live in code — the persisted instances on
 * `staff_lifecycle_tasks` capture the label / description at the time of
 * instantiation so changing the template later doesn't rewrite history.
 */

export type LifecycleKind = 'onboarding' | 'offboarding' | 'probation_review' | 'contract_renewal'

export type LifecycleTaskTemplate = {
  key: string
  label: string
  description?: string
  /** Days from instantiation to suggested due date. */
  defaultDueDays?: number
}

export const LIFECYCLE_TEMPLATES: Record<LifecycleKind, LifecycleTaskTemplate[]> = {
  onboarding: [
    {
      key: 'nda_signed',
      label: 'NDA signed',
      description: 'Non-disclosure agreement countersigned and filed under documents.',
      defaultDueDays: 3,
    },
    {
      key: 'employment_contract_signed',
      label: 'Employment contract signed',
      description: 'Contract issued and signed by both parties.',
      defaultDueDays: 3,
    },
    {
      key: 'it_equipment_issued',
      label: 'IT equipment issued',
      description: 'Laptop, badge, and device User ID assigned.',
      defaultDueDays: 1,
    },
    {
      key: 'pwa_account_setup',
      label: 'PWA account set up',
      description: 'Initial password issued and shared securely.',
      defaultDueDays: 1,
    },
    {
      key: 'mandatory_training_enrolled',
      label: 'Mandatory training enrolled',
      description: 'All role-appropriate mandatory modules assigned.',
      defaultDueDays: 7,
    },
    {
      key: 'credentials_uploaded',
      label: 'Clinical credentials uploaded',
      description: 'License, BLS, indemnity insurance — uploaded and pending verification.',
      defaultDueDays: 14,
    },
    {
      key: 'orientation_complete',
      label: 'Clinic orientation complete',
      description: 'Tour, intro to teammates, SOP walk-through.',
      defaultDueDays: 7,
    },
  ],
  offboarding: [
    {
      key: 'access_revoked',
      label: 'Access revoked',
      description:
        'Portal, PWA, and Access Management entries cleared (offboard endpoint handles most of this).',
    },
    {
      key: 'equipment_returned',
      label: 'Equipment returned',
      description: 'Laptop, badge, clinic-issued PPE returned.',
      defaultDueDays: 3,
    },
    {
      key: 'knowledge_transfer',
      label: 'Knowledge transfer complete',
      description: 'Handover notes delivered to manager / replacement.',
      defaultDueDays: 7,
    },
    {
      key: 'final_payslip_issued',
      label: 'Final payslip + accrued leave settled',
      description: 'Outstanding salary and unused leave balance processed.',
      defaultDueDays: 14,
    },
    {
      key: 'exit_interview',
      label: 'Exit interview',
      description: 'Structured exit conversation recorded by HR.',
      defaultDueDays: 5,
    },
  ],
  probation_review: [
    {
      key: 'manager_assessment',
      label: "Manager's probation assessment",
      description: 'Performance, fit, and recommendation captured.',
    },
    {
      key: 'staff_self_review',
      label: 'Staff self-review',
      description: 'Staff completes a short self-review form.',
    },
    {
      key: 'probation_decision',
      label: 'Probation outcome decided',
      description: 'Confirm continuation, extend probation, or terminate.',
    },
  ],
  contract_renewal: [
    {
      key: 'renewal_intent_captured',
      label: 'Renewal intent captured',
      description: 'Both manager and staff confirm intent to renew.',
    },
    {
      key: 'updated_contract_signed',
      label: 'Updated contract signed',
      description: 'New contract drafted, signed, and filed.',
    },
  ],
}

export function templateFor(kind: LifecycleKind): LifecycleTaskTemplate[] {
  return LIFECYCLE_TEMPLATES[kind] ?? []
}
