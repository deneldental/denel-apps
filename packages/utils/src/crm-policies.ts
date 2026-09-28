/**
 * `crm:automation_policies` (Settings → CRM → Automations) as both the backend
 * and the portal read it — settings-domain-audit S5-B.
 *
 *   reminder24h / reminder2h / reminderTemplate — two global-default appointment
 *     reminder stages the backend keeps in `appointment_type_reminders`.
 *   birthdayGreetings / birthdaySendTime / birthdayTemplate — the daily CRM
 *     auto-queue's birthday segment (queued for staff confirmation).
 *   recall*Months — presets offered when a recare plan is created.
 *   quietHours* — the scheduler holds queued sends inside the window.
 *
 * Templates use the engine's `{placeholder}` form; the older `{{snake_case}}`
 * tags some rows still carry are rewritten by `normalizeSmsTags`.
 */

export interface CrmAutomationPolicies {
  reminder24h: boolean
  reminder2h: boolean
  reminderTemplate: string
  birthdayGreetings: boolean
  /** `HH:mm`, clinic-local. */
  birthdaySendTime: string
  birthdayTemplate: string
  recallCheckupMonths: number
  recallPerioMonths: number
  recallScalingMonths: number
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
}

export const DEFAULT_CRM_POLICIES: CrmAutomationPolicies = {
  reminder24h: true,
  reminder2h: true,
  reminderTemplate:
    'Hello {patientName}, this is a reminder of your dental appointment on {appointmentDate} at {appointmentTime}. Please call us if you need to reschedule.',
  birthdayGreetings: true,
  birthdaySendTime: '09:00',
  birthdayTemplate:
    'Happy Birthday {firstName}! Wishing you a wonderful day from all of us at {clinicName}.',
  recallCheckupMonths: 6,
  recallPerioMonths: 3,
  recallScalingMonths: 6,
  quietHoursEnabled: true,
  quietHoursStart: '20:00',
  quietHoursEnd: '08:00',
}

/** Legacy `{{snake_case}}` tags → the placeholders the send paths render. */
const SMS_TAG_ALIASES: Record<string, string> = {
  patient_name: 'patientName',
  first_name: 'firstName',
  appointment_time: 'appointmentTime',
  appointment_date: 'appointmentDate',
  clinic_name: 'clinicName',
}

export function normalizeSmsTags(text: string): string {
  return text.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_m, tag: string) => `{${SMS_TAG_ALIASES[tag] ?? tag}}`
  )
}

const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && CLOCK_RE.test(value)
}

/** Minutes since midnight, or null for anything that is not `HH:mm`. */
export function parseClockTime(value: string): number | null {
  if (!isClockTime(value)) return null
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

/** The same calendar day as `day`, at `HH:mm` local time. */
export function atClockTime(day: Date, hhmm: string): Date {
  const minutes = parseClockTime(hhmm) ?? 0
  const d = new Date(day)
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d
}

/**
 * True when `now` falls inside [start, end) in local time. An overnight window
 * (start > end, e.g. 20:00 → 08:00) wraps midnight. An empty or invalid window
 * is never quiet.
 */
export function isWithinQuietHours(now: Date, start: string, end: string): boolean {
  const s = parseClockTime(start)
  const e = parseClockTime(end)
  if (s === null || e === null || s === e) return false
  const m = now.getHours() * 60 + now.getMinutes()
  return s < e ? m >= s && m < e : m >= s || m < e
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function template(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== ''
    ? normalizeSmsTags(value.trim())
    : fallback
}

function clock(value: unknown, fallback: string): string {
  return isClockTime(value) ? value : fallback
}

/** Field by field: a missing or malformed field falls back to its default. */
export function normalizeCrmPolicies(raw: unknown): CrmAutomationPolicies {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_CRM_POLICIES
  return {
    reminder24h: bool(r.reminder24h, d.reminder24h),
    reminder2h: bool(r.reminder2h, d.reminder2h),
    reminderTemplate: template(r.reminderTemplate, d.reminderTemplate),
    birthdayGreetings: bool(r.birthdayGreetings, d.birthdayGreetings),
    birthdaySendTime: clock(r.birthdaySendTime, d.birthdaySendTime),
    birthdayTemplate: template(r.birthdayTemplate, d.birthdayTemplate),
    recallCheckupMonths: positiveInt(r.recallCheckupMonths, d.recallCheckupMonths),
    recallPerioMonths: positiveInt(r.recallPerioMonths, d.recallPerioMonths),
    recallScalingMonths: positiveInt(r.recallScalingMonths, d.recallScalingMonths),
    quietHoursEnabled: bool(r.quietHoursEnabled, d.quietHoursEnabled),
    quietHoursStart: clock(r.quietHoursStart, d.quietHoursStart),
    quietHoursEnd: clock(r.quietHoursEnd, d.quietHoursEnd),
  }
}
