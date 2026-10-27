/**
 * Which actions a visit offers, decided in one place (F09, decision D6).
 *
 * The detail dialog and the Today column each used to decide this for themselves
 * and disagreed: Check In was offered for a patient already checked in or in the
 * chair, which reopened the payment sheet and allowed a second payment. These
 * rules mirror the server's status machine (backend/src/lib/appointment-status.ts),
 * which is the authority: this module only decides what to OFFER, so staff are not
 * shown buttons the server will refuse.
 */

/** The patient has not arrived yet. Includes the two legacy statuses older data carries. */
const PRE_ARRIVAL_STATUSES: ReadonlySet<string> = new Set([
  'scheduled',
  'confirmed',
  'rescheduled',
  'booked',
  'unconfirmed',
])

/** A visit with no status yet is treated as scheduled, as the calendar already does. */
function normalise(status: string | null | undefined): string {
  return status ?? 'scheduled'
}

export function canCheckIn(status: string | null | undefined): boolean {
  return PRE_ARRIVAL_STATUSES.has(normalise(status))
}

export interface AppointmentActions {
  checkIn: boolean
  reschedule: boolean
  sendReminder: boolean
  noShow: boolean
  cancel: boolean
  seat: boolean
  complete: boolean
}

const NO_ACTIONS: AppointmentActions = {
  checkIn: false,
  reschedule: false,
  sendReminder: false,
  noShow: false,
  cancel: false,
  seat: false,
  complete: false,
}

/**
 * The actions a visit in `status` offers.
 *
 * `closeOutOnly` is the non-admin view of YESTERDAY's visit (decision D6): the only
 * thing they may do is close it out, as no-show if the patient never arrived or as
 * completed if they did. Everything else on a past visit is the admin's.
 */
export function actionsFor(
  status: string | null | undefined,
  options: { closeOutOnly?: boolean } = {}
): AppointmentActions {
  const s = normalise(status)
  const preArrival = PRE_ARRIVAL_STATUSES.has(s)

  if (options.closeOutOnly) {
    if (preArrival) return { ...NO_ACTIONS, noShow: true }
    if (s === 'checked_in' || s === 'in_chair') return { ...NO_ACTIONS, complete: true }
    return NO_ACTIONS
  }

  if (preArrival) {
    return {
      ...NO_ACTIONS,
      checkIn: true,
      reschedule: true,
      sendReminder: true,
      noShow: true,
      cancel: true,
    }
  }
  if (s === 'checked_in') return { ...NO_ACTIONS, seat: true, cancel: true }
  if (s === 'in_chair') return { ...NO_ACTIONS, complete: true }
  return NO_ACTIONS
}

/** Was `date` on the calendar day before `now`'s? (The server uses the clinic's day; the two agree for a clinic in the browser's zone.) */
export function isYesterday(date: Date, now: Date = new Date()): boolean {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()
  const t = date.getTime()
  return t >= startOfYesterday && t < startOfToday
}
