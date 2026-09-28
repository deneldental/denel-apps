import type {
  ActionItemsData,
  AppointmentRow,
  RecareDueItem,
  Reminder,
} from '@/features/dashboard/types'
import { api } from '@/lib/api-client'

export async function fetchActionItems(isAdminView: boolean): Promise<ActionItemsData> {
  const endOfWeek = new Date()
  endOfWeek.setDate(endOfWeek.getDate() + 7)

  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStart = new Date(tomorrow.setHours(0, 0, 0, 0))
  const tomorrowEnd = new Date(tomorrow.setHours(23, 59, 59, 999))

  const [recallsRes, remindersRes, apptsRes] = await Promise.all([
    api
      .get<RecareDueItem[]>(`/api/crm/recare-due?dueBefore=${endOfWeek.toISOString()}`)
      .catch(() => ({ success: false as const, data: [] as RecareDueItem[] })),
    api
      .get<Reminder[]>(
        `/api/patient-reminders?dueBefore=${endOfToday.toISOString()}${isAdminView ? '' : '&assignedToMe=true'}`
      )
      .catch(() => ({ success: false as const, data: [] as Reminder[] })),
    api
      .get<AppointmentRow[]>(
        `/api/appointments?from=${tomorrowStart.toISOString()}&to=${tomorrowEnd.toISOString()}`
      )
      .catch(() => ({ success: false as const, data: [] as AppointmentRow[] })),
  ])

  const recalls =
    recallsRes.success && recallsRes.data
      ? recallsRes.data.filter((r) => ['pending', 'due', 'overdue'].includes(r.status))
      : []
  const reminders =
    remindersRes.success && remindersRes.data
      ? remindersRes.data.filter((r) => r.status === 'pending')
      : []
  const unconfirmedAppts =
    apptsRes.success && apptsRes.data
      ? apptsRes.data.filter(
          (a) =>
            (a.status === 'scheduled' || a.status === 'rescheduled') &&
            a.confirmationResponse !== 'yes'
        )
      : []

  return { recalls, reminders, unconfirmedAppts }
}
