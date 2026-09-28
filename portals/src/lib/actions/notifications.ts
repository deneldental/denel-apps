import { api } from '@/lib/api-client'

/**
 * Staff memos surfaced in the portal's Activity → Notifications tab.
 *
 * Reuses the same `/api/staff-portal/memos` endpoints the Team PWA uses — the
 * backend resolves the caller's staff record from the session, so a doctor
 * signed into the portal sees exactly the memos targeted at them. Callers must
 * tolerate a 401: portal users without a `staff` row have no memo feed.
 */
export interface StaffMemo {
  id: string
  title: string
  memoType: string
  audience: string
  level: string
  content: string
  createdAt: string
  acknowledged: boolean
}

export const getMyMemos = () =>
  api.get<StaffMemo[]>('/api/staff-portal/memos', { suppressSessionExpired: true })

export const acknowledgeMemo = (memoId: string) =>
  api.post(`/api/staff-portal/memos/${memoId}/acknowledge`, {})
