import {
  Bell,
  CalendarCheck,
  CalendarX,
  CheckCircle2,
  ClipboardList,
  ClipboardPen,
  CreditCard,
  FileText,
  MessageSquare,
  PauseCircle,
  ScrollText,
  Stethoscope,
  UserPlus,
  Wallet,
} from 'lucide-react'
import type { ComponentType } from 'react'

/**
 * Central style + icon map for patient-timeline events. See D.4 in
 * ui-refinement-IP.md — colors are the primary differentiator, icons
 * secondary. Every renderer that draws a timeline entry should pull from
 * here so event colors stay consistent across modules.
 *
 * Keys mirror the `event_type` values emitted by the backend's
 * `/api/patient-timeline/:patientId` endpoint. New kinds go here first,
 * then any UI automatically picks them up.
 */

export type TimelineEventKind =
  | 'registration'
  | 'appointment'
  | 'appointment_cancelled'
  | 'treatment'
  | 'medical_record_added'
  | 'medical_record_updated'
  | 'invoice_issued'
  | 'payment_received'
  | 'plan_created'
  | 'plan_completed'
  | 'plan_paused'
  | 'sms_sent'
  | 'consent_signed'
  | 'wallet_credit'
  | 'wallet_debit'
  | 'reminder_sent'
  | 'document_uploaded'
  | 'note'

export interface TimelineEventStyle {
  /** Tailwind text color class for the icon (must be contrast-safe on tinted bg). */
  iconText: string
  /** Tailwind background color class for the icon halo. */
  iconBg: string
  /** Short label rendered inside a Badge next to the event title. */
  badgeLabel: string
  /** Shadcn Badge variant — controls fill/text combo for the badge. */
  badgeVariant: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
  icon: ComponentType<{ className?: string }>
}

export const TIMELINE_EVENT_STYLES: Record<TimelineEventKind, TimelineEventStyle> = {
  registration: {
    iconText: 'text-sky-700 dark:text-sky-400',
    iconBg: 'bg-sky-100 dark:bg-sky-900/30',
    badgeLabel: 'Registration',
    badgeVariant: 'default',
    icon: UserPlus,
  },
  appointment: {
    iconText: 'text-rose-700 dark:text-rose-400',
    iconBg: 'bg-rose-100 dark:bg-rose-900/30',
    badgeLabel: 'Appointment',
    badgeVariant: 'success',
    icon: CalendarCheck,
  },
  appointment_cancelled: {
    iconText: 'text-red-700 dark:text-red-400',
    iconBg: 'bg-red-100 dark:bg-red-900/30',
    badgeLabel: 'Cancelled',
    badgeVariant: 'destructive',
    icon: CalendarX,
  },
  treatment: {
    iconText: 'text-purple-700 dark:text-purple-400',
    iconBg: 'bg-purple-100 dark:bg-purple-900/30',
    badgeLabel: 'Treatment',
    badgeVariant: 'secondary',
    icon: Stethoscope,
  },
  medical_record_added: {
    iconText: 'text-indigo-700 dark:text-indigo-400',
    iconBg: 'bg-indigo-100 dark:bg-indigo-900/30',
    badgeLabel: 'Record Added',
    badgeVariant: 'default',
    icon: Stethoscope,
  },
  medical_record_updated: {
    iconText: 'text-cyan-700 dark:text-cyan-400',
    iconBg: 'bg-cyan-100 dark:bg-cyan-900/30',
    badgeLabel: 'Record Updated',
    badgeVariant: 'secondary',
    icon: ClipboardPen,
  },
  invoice_issued: {
    iconText: 'text-orange-700 dark:text-orange-400',
    iconBg: 'bg-orange-100 dark:bg-orange-900/30',
    badgeLabel: 'Invoice',
    badgeVariant: 'warning',
    icon: FileText,
  },
  payment_received: {
    iconText: 'text-emerald-700 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/30',
    badgeLabel: 'Payment',
    badgeVariant: 'success',
    icon: CreditCard,
  },
  plan_created: {
    iconText: 'text-amber-700 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-900/30',
    badgeLabel: 'Plan',
    badgeVariant: 'default',
    icon: ClipboardList,
  },
  plan_completed: {
    iconText: 'text-violet-700 dark:text-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-900/30',
    badgeLabel: 'Completed',
    badgeVariant: 'success',
    icon: CheckCircle2,
  },
  plan_paused: {
    iconText: 'text-yellow-700 dark:text-yellow-400',
    iconBg: 'bg-yellow-100 dark:bg-yellow-900/30',
    badgeLabel: 'Paused',
    badgeVariant: 'warning',
    icon: PauseCircle,
  },
  sms_sent: {
    iconText: 'text-sky-700 dark:text-sky-400',
    iconBg: 'bg-sky-100 dark:bg-sky-900/30',
    badgeLabel: 'SMS',
    badgeVariant: 'secondary',
    icon: MessageSquare,
  },
  consent_signed: {
    iconText: 'text-violet-700 dark:text-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-900/30',
    badgeLabel: 'Consent',
    badgeVariant: 'secondary',
    icon: ScrollText,
  },
  wallet_credit: {
    iconText: 'text-teal-700 dark:text-teal-400',
    iconBg: 'bg-teal-100 dark:bg-teal-900/30',
    badgeLabel: 'Credit',
    badgeVariant: 'success',
    icon: Wallet,
  },
  wallet_debit: {
    iconText: 'text-rose-700 dark:text-rose-400',
    iconBg: 'bg-rose-100 dark:bg-rose-900/30',
    badgeLabel: 'Debit',
    badgeVariant: 'destructive',
    icon: Wallet,
  },
  reminder_sent: {
    iconText: 'text-orange-700 dark:text-orange-400',
    iconBg: 'bg-orange-100 dark:bg-orange-900/30',
    badgeLabel: 'Reminder',
    badgeVariant: 'warning',
    icon: Bell,
  },
  document_uploaded: {
    iconText: 'text-foreground dark:text-slate-300',
    iconBg: 'bg-slate-100 dark:bg-slate-800',
    badgeLabel: 'Document',
    badgeVariant: 'outline',
    icon: FileText,
  },
  note: {
    iconText: 'text-foreground dark:text-slate-300',
    iconBg: 'bg-slate-100 dark:bg-slate-800',
    badgeLabel: 'Note',
    badgeVariant: 'outline',
    icon: Bell,
  },
}

/**
 * Lookup with a safe fallback — unknown event types fall back to the `note`
 * styling (neutral slate) so the UI never crashes if the backend emits a
 * kind we haven't styled yet.
 */
export function getTimelineEventStyle(eventType: string): TimelineEventStyle {
  return TIMELINE_EVENT_STYLES[eventType as TimelineEventKind] ?? TIMELINE_EVENT_STYLES.note
}
