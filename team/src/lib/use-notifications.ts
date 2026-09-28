import { useCallback, useEffect, useReducer, useState } from 'react'
import { staffApi } from './api'

export type NotifKind = 'memo' | 'task' | 'request' | 'request_approved' | 'request_rejected'

export interface NotifItem {
  id: string
  kind: NotifKind
  title: string
  body: string
  /** ISO date used for sorting + display. */
  date: string
  /** Where tapping the notification takes the user. */
  to: string
  /** False until read — drives the "New" tag + badge count. */
  read: boolean
}

/** Per-item read state lives client-side (one device). The notifications are
 *  derived from already-persisted server data, so they survive reloads; only
 *  "have I seen this yet" is local. */
const READ_KEY = 'team_notif_read_ids'

function getReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? (arr as string[]) : [])
  } catch {
    return new Set()
  }
}

function persistReadIds(ids: Set<string>) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids]))
  } catch {
    // storage disabled — read state just won't persist; harmless
  }
}

/** Mark one notification read — the badge counts down by one. */
export function markNotificationRead(id: string) {
  const ids = getReadIds()
  if (ids.has(id)) return
  ids.add(id)
  persistReadIds(ids)
  window.dispatchEvent(new Event('team-notifs-read'))
}

/** Mark a batch read — the badge clears. */
export function markAllNotificationsRead(ids: string[]) {
  const set = getReadIds()
  let changed = false
  for (const id of ids) {
    if (!set.has(id)) {
      set.add(id)
      changed = true
    }
  }
  if (changed) {
    persistReadIds(set)
    window.dispatchEvent(new Event('team-notifs-read'))
  }
}

const REQUEST_TYPE_LABELS: Record<string, string> = {
  leave: 'Leave request',
  permit: 'Permit',
  emergency: 'Emergency support',
  official_support: 'Official support',
}

function requestLabel(type: string): string {
  return REQUEST_TYPE_LABELS[type] ?? 'Request'
}

type RawNotif = Omit<NotifItem, 'read'>

/**
 * Aggregates a staff member's alerts into one feed: unacknowledged memos and
 * status updates on their own requests (approved / declined / pending). Each
 * item carries a per-device read flag; the header bell counts the unread ones
 * and counts down as they're read.
 */
export function useStaffNotifications() {
  const [raw, setRaw] = useState<RawNotif[]>([])
  const [loading, setLoading] = useState(true)
  // Read state is computed fresh from localStorage on each render (always a Set);
  // this counter just forces a re-render when it changes. Keeping a Set in state
  // is fragile across Fast-Refresh, so we don't.
  const [, bumpRead] = useReducer((n: number) => n + 1, 0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [memoRes, reqRes, taskRes] = await Promise.all([
        staffApi.getMemos(),
        staffApi.getRequests(),
        staffApi.getMyTasks(),
      ])

      // biome-ignore lint/suspicious/noExplicitAny: loose staff-portal payloads
      const memos: any[] = memoRes.success && Array.isArray(memoRes.data) ? memoRes.data : []
      // biome-ignore lint/suspicious/noExplicitAny: loose staff-portal payloads
      const requests: any[] = reqRes.success && Array.isArray(reqRes.data) ? reqRes.data : []
      // biome-ignore lint/suspicious/noExplicitAny: loose /api/tasks/mine payload
      const tasks: any[] = taskRes.success && Array.isArray(taskRes.data) ? taskRes.data : []

      const list: RawNotif[] = []

      for (const m of memos) {
        if (m.acknowledged) continue // handled → drops off the feed
        list.push({
          id: `memo-${m.id}`,
          kind: 'memo',
          title: m.title || 'New memo',
          body:
            m.level === 'important' ? 'Important — tap to read.' : 'Tap to read and acknowledge.',
          date: m.postedAt || m.publishedAt || m.createdAt || new Date().toISOString(),
          to: '/memos',
        })
      }

      for (const r of requests) {
        const label = requestLabel(r.requestType)
        if (r.status === 'approved') {
          list.push({
            id: `req-${r.id}`,
            kind: 'request_approved',
            title: `${label} approved`,
            body: r.reviewComments || 'Your request was approved.',
            date: r.submittedAt,
            to: '/requests',
          })
        } else if (r.status === 'rejected') {
          list.push({
            id: `req-${r.id}`,
            kind: 'request_rejected',
            title: `${label} declined`,
            body: r.reviewComments || r.reason || 'Your request was declined.',
            date: r.submittedAt,
            to: '/requests',
          })
        } else if (r.status === 'pending') {
          list.push({
            id: `req-${r.id}`,
            kind: 'request',
            title: `${label} pending`,
            body: 'Awaiting review from your manager.',
            date: r.submittedAt,
            to: '/requests',
          })
        }
      }

      // HR-assigned tasks belong in the bell too — previously only memos +
      // request decisions surfaced here, so a new task was invisible unless the
      // staff happened to open the Tasks page.
      for (const t of tasks) {
        if (t.status === 'done') continue
        list.push({
          id: `task-${t.assignmentId}`,
          kind: 'task',
          title: t.title || 'New task',
          body: t.dueAt
            ? `Due ${new Date(t.dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
            : 'Tap to view and mark it done.',
          date: t.createdAt || new Date().toISOString(),
          to: '/tasks',
        })
      }

      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

      // Drop read-ids whose item no longer exists, so localStorage stays bounded
      // and a re-appearing item re-alerts.
      const currentIds = new Set(list.map((i) => i.id))
      const nextRead = getReadIds()
      let pruned = false
      for (const rid of [...nextRead]) {
        if (!currentIds.has(rid)) {
          nextRead.delete(rid)
          pruned = true
        }
      }
      if (pruned) persistReadIds(nextRead)

      setRaw(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load().catch(() => {})
    const refetch = () => load().catch(() => {})
    const resync = () => bumpRead()
    window.addEventListener('focus', refetch)
    window.addEventListener('team-notifs-read', resync)
    return () => {
      window.removeEventListener('focus', refetch)
      window.removeEventListener('team-notifs-read', resync)
    }
  }, [load])

  const readIds = getReadIds()
  const items: NotifItem[] = raw.map((i) => ({ ...i, read: readIds.has(i.id) }))
  const count = items.reduce((n, i) => n + (i.read ? 0 : 1), 0)

  const markAllRead = useCallback(() => {
    markAllNotificationsRead(raw.map((i) => i.id))
  }, [raw])

  return { items, count, loading, refresh: load, markAllRead }
}
