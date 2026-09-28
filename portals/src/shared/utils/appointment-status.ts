import {
  CalendarCheck,
  CalendarClock,
  CalendarOff,
  CalendarX,
  CheckCircle2,
  UserCheck,
} from 'lucide-react'
import type { ComponentType } from 'react'

/**
 * Central style + icon map for appointment statuses. See D.6 in
 * ui-refinement-IP.md — colors are the primary differentiator on the
 * scheduling calendar; icons are secondary. Every renderer that draws an
 * appointment cell, list row, or badge should pull from here so the visual
 * language stays consistent across the calendar grid, day list, dialogs,
 * and patient timeline.
 *
 * Convention:
 *   - `accentBg` is the solid color used for the 4-px left-edge accent bar
 *     on the calendar card.
 *   - `bg` + `text` are paired tints for badges and the card body fill.
 *   - `border` is the outline color for outline-style cards (and is rendered
 *     dashed by the consumer for `no_show`).
 *
 * Past appointments dim uniformly to opacity-50 regardless of status (see
 * `getAppointmentDimming`); cancelled additionally renders a strikethrough.
 *
 * Keys mirror the `status` values emitted by the backend's
 * `/api/appointments` endpoint. New statuses go here first, then any UI
 * automatically picks them up.
 */

export type AppointmentStatus =
  | 'scheduled'
  | 'rescheduled'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export interface AppointmentStatusStyle {
  /** Solid color for the left-edge accent bar on calendar cards. */
  accentBg: string
  /** Tinted background for badges + card body. */
  bg: string
  /** Text color paired with bg. */
  text: string
  /** Border color for outline-style cards. */
  border: string
  badgeLabel: string
  badgeVariant: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
  /** Lucide icon for the status. */
  icon: ComponentType<{ className?: string }>
}

export const APPOINTMENT_STATUS_STYLES: Record<AppointmentStatus, AppointmentStatusStyle> = {
  scheduled: {
    accentBg: 'bg-blue-500',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-300',
    badgeLabel: 'Scheduled',
    badgeVariant: 'default',
    icon: CalendarCheck,
  },
  rescheduled: {
    accentBg: 'bg-amber-500',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-300',
    badgeLabel: 'Rescheduled',
    badgeVariant: 'warning',
    icon: CalendarClock,
  },
  checked_in: {
    accentBg: 'bg-emerald-500',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-300',
    badgeLabel: 'Checked-in',
    badgeVariant: 'success',
    icon: UserCheck,
  },
  completed: {
    accentBg: 'bg-emerald-300',
    bg: 'bg-muted',
    text: 'text-foreground',
    border: 'border-emerald-200',
    badgeLabel: 'Completed',
    badgeVariant: 'secondary',
    icon: CheckCircle2,
  },
  cancelled: {
    accentBg: 'bg-slate-300',
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    border: 'border-border',
    badgeLabel: 'Cancelled',
    badgeVariant: 'outline',
    icon: CalendarX,
  },
  no_show: {
    accentBg: 'bg-orange-200',
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    border: 'border-orange-300',
    badgeLabel: 'No-show',
    badgeVariant: 'destructive',
    icon: CalendarOff,
  },
}

/**
 * Lookup with a safe fallback — unknown statuses fall back to `scheduled`
 * styling so the UI never crashes if the backend emits a status we haven't
 * styled yet.
 */
export function getAppointmentStatusStyle(status: string): AppointmentStatusStyle {
  return (
    APPOINTMENT_STATUS_STYLES[status as AppointmentStatus] ?? APPOINTMENT_STATUS_STYLES.scheduled
  )
}

/**
 * Helper: returns true if the appointment time is in the past relative to
 * `now` (defaults to `new Date()`). Past appointments are dimmed in the UI
 * even when their status is still active, to draw the eye to upcoming work.
 */
export function isAppointmentPast(startTime: string | Date, now?: Date): boolean {
  const start = typeof startTime === 'string' ? new Date(startTime) : startTime
  const reference = now ?? new Date()
  return start.getTime() < reference.getTime()
}

/**
 * Helper: returns the effective rendering opacity + strikethrough for the
 * cell. cancelled, no_show, and any past appointment dim to opacity-50;
 * cancelled additionally gets line-through to make the dead state obvious.
 */
export function getAppointmentDimming(
  status: AppointmentStatus,
  isPast: boolean
): { opacity: string; strikethrough: boolean } {
  const dim = isPast || status === 'cancelled' || status === 'no_show'
  return {
    opacity: dim ? 'opacity-50' : 'opacity-100',
    strikethrough: status === 'cancelled',
  }
}
