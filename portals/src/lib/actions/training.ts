// Training action wrappers — admin-v1 §15.1 (mandatory / recurring) + §15.2
// (role bulk assign). These sit alongside the older training
// helpers in actions/staff.ts; they're split out here so the /training feature
// owns its own data layer for the scheduling + bulk-assign surfaces.
//
// Backend contracts (backend/src/routes/staff-training.ts):
//   GET  /api/staff/training/learners-admin
//        → learners + per-assignment derivedStatus / dueDate / expiresAt / renewalMonths
//   POST /api/staff/training/:id/assign-staff   { staffIds, dueDate?, renewalMonths? }
//   POST /api/staff/training/:id/bulk-assign     { role, dueDate?, renewalMonths? }
//   POST /api/staff/training/reopen-expired

import { api } from '@/lib/api-client'

/**
 * Read-time renewal view layered on top of the stored status by the backend
 * (`deriveTrainingStatus`). Mirrors the union in
 * backend/src/lib/training-renewal.ts.
 */
export type DerivedTrainingStatus =
  | 'completed'
  | 'expired'
  | 'overdue'
  | 'due'
  | 'in_progress'
  | 'not_started'

/** One assigned material's progress for a learner, with the §15.1 schedule fields. */
export type TrainingLearnerProgress = {
  trainingId: string
  title: string
  materialType: string
  status: string
  /** Read-time due/overdue/expired view on top of `status`. */
  derivedStatus: DerivedTrainingStatus
  /** When the assignment must be completed by (ISO) or null for none. */
  dueDate: string | null
  /** Re-cert deadline once completed (ISO) or null for one-off. */
  expiresAt: string | null
  /** Re-cert cadence in months, or null for one-off. */
  renewalMonths: number | null
  progressPercent: number
  score: number | null
  completedAt: string | null
}

export type TrainingLearner = {
  id: string
  name: string
  email: string | null
  role: string | null
  progressByModule: TrainingLearnerProgress[]
}

/**
 * Admin learners view — every active non-trainer staff + their progress across
 * all published materials, including the §15.1 schedule fields. Same endpoint
 * as actions/staff.ts#getAllLearnersAdmin but typed to surface the renewal data.
 */
export async function getTrainingLearnersAdmin() {
  return api.get<TrainingLearner[]>('/api/staff/training/learners-admin')
}

/**
 * §15.1 — assign published materials to specific staff with an optional due
 * date + renewal cadence. `dueDate` is an ISO string (or null to leave unset);
 * `renewalMonths` is a positive integer (or null for a one-off).
 */
export async function assignTrainingToStaff(
  trainingId: string,
  staffIds: string[],
  opts?: { dueDate?: string | null; renewalMonths?: number | null }
) {
  return api.post<{ added: number; total: number; alreadyBroadcast?: boolean }>(
    `/api/staff/training/${trainingId}/assign-staff`,
    {
      staffIds,
      ...(opts?.dueDate !== undefined ? { dueDate: opts.dueDate } : {}),
      ...(opts?.renewalMonths !== undefined ? { renewalMonths: opts.renewalMonths } : {}),
    }
  )
}

export type BulkAssignResult = {
  /** Active staff matched by the role filter. */
  matched: number
  /** New assignment rows actually inserted. */
  assigned: number
  /** Matched staff already assigned (idempotency skips). */
  skipped: number
  staffIds: string[]
}

/**
 * §15.2 — assign a material to every active staff member in a role in one
 * shot. A `role` is required.
 */
export async function bulkAssignTraining(
  trainingId: string,
  input: {
    role?: string | null
    dueDate?: string | null
    renewalMonths?: number | null
  }
) {
  return api.post<BulkAssignResult>(`/api/staff/training/${trainingId}/bulk-assign`, input)
}

export type ReopenExpiredResult = {
  /** Completed recurring rows whose expiresAt was backfilled. */
  backfilled: number
  /** Rows re-opened for re-certification. */
  reopened: number
}

/**
 * §15.1 — re-open expired recurring training (manual trigger of the renewal
 * sweep). Backfills missing expiresAt, then re-opens any past-expiry rows.
 */
export async function reopenExpiredTraining() {
  return api.post<ReopenExpiredResult>('/api/staff/training/reopen-expired', {})
}
