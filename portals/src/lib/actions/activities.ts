import { api } from '@/lib/api-client'

// admin-v1 §1.1 / §3.3 — the shared activity-completions log. Every "mark done"
// across the dashboard + reminders surfaces records here so the Completed tab is
// consistent and the Pending list subtracts what's done.

export type ActivityType = 'recare' | 'patient_reminder' | 'birthday' | 'unconfirmed' | 'overdue'

export interface CompletedActivity {
  id: string
  activityType: string
  refId: string | null
  label: string | null
  completedAt: string
  completedByName: string | null
}

/** Log a completion. Idempotent server-side per (activityType, refId). */
export function completeActivity(input: {
  activityType: ActivityType
  refId?: string
  label?: string
}) {
  return api.post<{ id: string }>('/api/activities/complete', input)
}

/** Paginated Completed history. */
export function getCompletedActivities(params?: {
  limit?: number
  offset?: number
  activityType?: ActivityType
}) {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  if (params?.activityType) q.set('activityType', params.activityType)
  const qs = q.toString()
  return api.get<CompletedActivity[]>(`/api/activities/completed${qs ? `?${qs}` : ''}`)
}

/** Undo a completion (returns the item to Pending). */
export function uncompleteActivity(id: string) {
  return api.delete(`/api/activities/completed/${id}`)
}
