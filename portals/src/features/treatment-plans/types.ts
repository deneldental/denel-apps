export type TreatmentPlanStatus =
  | 'draft'
  | 'presented'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'declined'

export type TreatmentPlanItemStatus = 'pending' | 'scheduled' | 'completed' | 'cancelled'

export interface TreatmentPlanItem {
  id: string
  planId: string
  procedureName: string
  treatmentTypeId: string | null
  toothNumber: number | null
  phase: number
  estimatedCost: number
  status: TreatmentPlanItemStatus
  appointmentId: string | null
  notes: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface TreatmentPlan {
  id: string
  patientId: string
  title: string
  totalEstimated: number
  status: TreatmentPlanStatus
  presentedAt: string | null
  acceptedAt: string | null
  declinedAt: string | null
  completedAt: string | null
  signatureData: string | null
  signedByName: string | null
  signedRelationship: string | null
  notes: string | null
  createdById: string | null
  createdAt: string
  updatedAt: string
  items: TreatmentPlanItem[]
}

export const STATUS_LABELS: Record<TreatmentPlanStatus, string> = {
  draft: 'Draft',
  presented: 'Presented',
  accepted: 'Accepted',
  in_progress: 'In Progress',
  completed: 'Completed',
  declined: 'Declined',
}

export const STATUS_VARIANT: Record<
  TreatmentPlanStatus,
  'default' | 'secondary' | 'success' | 'destructive' | 'outline' | 'warning'
> = {
  draft: 'outline',
  presented: 'warning',
  accepted: 'success',
  in_progress: 'secondary',
  completed: 'default',
  declined: 'destructive',
}
