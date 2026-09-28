import { formatCurrency } from '@denel/utils'
import { useCallback, useEffect, useReducer, useState } from 'react'
import { api } from './api'

export type NotifKind =
  | 'reminder'
  | 'request'
  | 'cancelled'
  | 'payment'
  | 'payment_confirmed'
  | 'payment_rejected'

export interface NotifItem {
  id: string
  kind: NotifKind
  title: string
  body: string
  /** ISO date used for sorting + display. */
  date: string
  /** Where tapping the notification takes the patient. */
  to: string
  /** False until the patient reads it — drives the "New" tag + badge count. */
  read: boolean
}

/** Per-item read state lives client-side (one device). The notifications
 *  themselves are derived from already-persisted server data, so they survive
 *  reloads; only "have I read this yet" is local. */
const READ_KEY = 'patient_notif_read_ids'

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

/** Mark a single notification read — the badge counts down by one. Dispatches an
 *  event so every mounted consumer (header badge + page) resyncs. */
export function markNotificationRead(id: string) {
  const ids = getReadIds()
  if (ids.has(id)) return
  ids.add(id)
  persistReadIds(ids)
  window.dispatchEvent(new Event('patient-notifs-read'))
}

/** Mark a batch of notifications read — the badge clears. */
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
    window.dispatchEvent(new Event('patient-notifs-read'))
  }
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

type RawNotif = Omit<NotifItem, 'read'>

/**
 * Aggregates the patient's alerts + pending actions into one feed: pending /
 * cancelled appointment requests, payment confirmations (approved / declined),
 * outstanding balance, and SMS reminders. Each item carries a per-device read
 * flag; the header badge counts the unread ones and counts down as they're read.
 */
export function usePatientNotifications() {
  const [raw, setRaw] = useState<RawNotif[]>([])
  const [loading, setLoading] = useState(true)
  // Read state is computed fresh from localStorage on each render (always a Set);
  // this counter just forces a re-render when it changes. Keeping a Set in state
  // is fragile across Fast-Refresh, so we don't.
  const [, bumpRead] = useReducer((n: number) => n + 1, 0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [reqRes, payRes, remRes, confRes] = await Promise.all([
        // biome-ignore lint/suspicious/noExplicitAny: loose patient-portal payloads
        api.get<any[]>('/api/patient-portal/appointment-requests'),
        // biome-ignore lint/suspicious/noExplicitAny: loose patient-portal payloads
        api.get<{ invoices: any[] }>('/api/patient-portal/payments'),
        // biome-ignore lint/suspicious/noExplicitAny: loose patient-portal payloads
        api.get<any[]>('/api/patient-portal/reminders'),
        // biome-ignore lint/suspicious/noExplicitAny: loose patient-portal payloads
        api.get<any[]>('/api/patient-portal/payment-confirmations'),
      ])

      // biome-ignore lint/suspicious/noExplicitAny: loose payload
      const reqs: any[] = Array.isArray(reqRes.data) ? reqRes.data : []
      const pending = reqs.filter((r) => r.status === 'new' || r.status === 'contacted')
      const cancelled = reqs.filter((r) => r.status === 'cancelled' && r.cancellationReason)
      // biome-ignore lint/suspicious/noExplicitAny: loose payload
      const invoices: any[] = payRes.data?.invoices ?? []
      const outstanding = invoices.filter((i) => Number(i.balance) > 0)
      const outstandingTotal = outstanding.reduce((s, i) => s + Number(i.balance), 0)
      // biome-ignore lint/suspicious/noExplicitAny: loose payload
      const reminders: any[] = Array.isArray(remRes.data) ? remRes.data : []
      // biome-ignore lint/suspicious/noExplicitAny: loose payload
      const confs: any[] = Array.isArray(confRes.data) ? confRes.data : []

      const list: RawNotif[] = []
      for (const r of pending) {
        list.push({
          id: `req-${r.id}`,
          kind: 'request',
          title: `${cap(r.requestType)} request pending`,
          body: 'Awaiting confirmation from the clinic.',
          date: r.createdAt,
          to: '/patient/appointments',
        })
      }
      for (const r of cancelled) {
        list.push({
          id: `cancel-${r.id}`,
          kind: 'cancelled',
          title: `${cap(r.requestType)} request cancelled`,
          body: r.cancellationReason,
          date: r.createdAt,
          to: '/patient/appointments',
        })
      }
      for (const c of confs) {
        if (c.status === 'confirmed') {
          list.push({
            id: `payconf-${c.id}`,
            kind: 'payment_confirmed',
            title: 'Payment confirmed',
            body: `${formatCurrency(Number(c.amount))} received — thank you!`,
            date: c.updatedAt ?? c.createdAt,
            to: '/patient/payments',
          })
        } else if (c.status === 'rejected') {
          list.push({
            id: `payconf-${c.id}`,
            kind: 'payment_rejected',
            title: 'Payment not confirmed',
            body: c.rejectionReason || 'Please review the details and submit again.',
            date: c.updatedAt ?? c.createdAt,
            to: '/patient/payments',
          })
        }
      }
      if (outstanding.length > 0) {
        list.push({
          id: 'outstanding',
          kind: 'payment',
          title: 'Payment due',
          body: `${formatCurrency(outstandingTotal)} across ${outstanding.length} invoice${outstanding.length === 1 ? '' : 's'}.`,
          date: new Date().toISOString(),
          to: '/patient/payments',
        })
      }
      for (const m of reminders) {
        list.push({
          id: `rem-${m.id}`,
          kind: 'reminder',
          title: m.subject || 'Reminder',
          body: m.body,
          date: m.scheduledFor,
          to: '/patient/reminders',
        })
      }
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

      // Drop read-ids whose item no longer exists, so localStorage stays bounded
      // and a re-appearing item (e.g. a new outstanding balance) re-alerts.
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
    window.addEventListener('patient-notifs-read', resync)
    return () => {
      window.removeEventListener('focus', refetch)
      window.removeEventListener('patient-notifs-read', resync)
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
