import { API_BASE_URL, api } from '@/lib/api-client'

export type GoogleCalendarStatus = {
  /** Whether the backend has the OAuth env vars set. If false the user can't connect at all. */
  configured: boolean
  /** Whether the *current user* has a connected Google account. */
  connected: boolean
  email: string | null
  calendarId: string | null
  connectedAt: string | null
}

export async function getGoogleCalendarStatus() {
  return api.get<GoogleCalendarStatus>('/api/google-calendar/status')
}

/**
 * Begin the Google OAuth flow. Returns a URL to redirect the browser to.
 * The backend's GET /connect issues a 302 to Google's consent screen — we
 * resolve that by setting window.location and letting the browser follow
 * redirects naturally (fetch with credentials wouldn't follow cross-origin
 * 302s anyway, and we *want* a full page navigation here).
 */
export function getConnectUrl(): string {
  return `${API_BASE_URL}/api/google-calendar/connect`
}

export async function disconnectGoogleCalendar() {
  return api.delete<{ disconnected: boolean }>('/api/google-calendar')
}

export type AppointmentSyncStatus = {
  method?: 'oauth' | 'service_account'
  configured: boolean
  doctorConnected: boolean
  eventLinked: boolean
  syncedAt: string | null
}

export async function getAppointmentSyncStatus(appointmentId: string) {
  return api.get<AppointmentSyncStatus>(`/api/google-calendar/appointment-sync/${appointmentId}`)
}

/** Manually trigger a re-sync for an existing appointment. Useful when the
 *  status reports "not linked" but the event already exists on the calendar
 *  (e.g. recovered from the pre-fix FK bug in SA mode). */
export async function resyncAppointmentToGoogle(appointmentId: string) {
  return api.post<{ success: boolean }>(
    `/api/google-calendar/appointment-sync/${appointmentId}/resync`,
    {}
  )
}

// ── Per-doctor calendar audit (SA mode) ─────────────────────────────────────

export type PerDoctorCalendarWarning =
  | 'no_specialist_link'
  | 'not_provisioned'
  | 'shared_with_fallback'
  | 'shared_with_other_doctor'
  | 'observed_mismatch_with_provisioned'

export type PerDoctorCalendarRow = {
  doctorId: string
  specialistId: string | null
  doctorName: string
  /** Calendar id stored on the specialist row — the SA's provisioning target. */
  provisionedCalendarId: string | null
  /** Distinct calendar(s) actual events landed on, from event_links. */
  observedCalendarIds: string[]
  eventCount: number
  lastSyncedAt: string | null
  warnings: PerDoctorCalendarWarning[]
}

export type PerDoctorCalendarStatus = {
  sharedFallbackCalendarId: string | null
  rows: PerDoctorCalendarRow[]
}

export async function getPerDoctorCalendarStatus() {
  return api.get<PerDoctorCalendarStatus>('/api/google-calendar/per-doctor-status')
}

// ── OAuth credential config (admin only) ────────────────────────────────────

export type GoogleOAuthConfigStatus = {
  source: 'db' | 'env' | 'none'
  clientId: string | null
  redirectUri: string | null
  hasClientSecret: boolean
}

export async function getGoogleOAuthConfig() {
  return api.get<GoogleOAuthConfigStatus>('/api/google-calendar/oauth-config')
}

/**
 * Save the OAuth config. Pass `clientSecret: null` (or omit) to keep the
 * existing encrypted secret while updating clientId / redirectUri.
 */
export async function saveGoogleOAuthConfig(input: {
  clientId: string
  clientSecret: string | null
  redirectUri: string
}) {
  return api.put<GoogleOAuthConfigStatus>('/api/google-calendar/oauth-config', input)
}

export async function clearGoogleOAuthConfig() {
  return api.delete<{ success: boolean }>('/api/google-calendar/oauth-config')
}

// ── Active auth method ──────────────────────────────────────────────────────

export type GoogleAuthMethod = 'oauth' | 'service_account'

export async function getActiveAuthMethod() {
  return api.get<{ method: GoogleAuthMethod }>('/api/google-calendar/auth-method')
}

export async function setActiveAuthMethod(method: GoogleAuthMethod) {
  return api.put<{ method: GoogleAuthMethod }>('/api/google-calendar/auth-method', { method })
}

// ── Service-account config ──────────────────────────────────────────────────

export type ServiceAccountStatus = {
  source: 'db' | 'none'
  clientEmail: string | null
  calendarId: string | null
  hasPrivateKey: boolean
}

export async function getServiceAccountConfig() {
  return api.get<ServiceAccountStatus>('/api/google-calendar/service-account-config')
}

export type ServiceAccountSaveInput = {
  clientEmail?: string
  privateKey?: string | null
  calendarId?: string
  /** Parsed JSON key file from GCP — fills clientEmail + privateKey in one paste. */
  jsonKey?: Record<string, unknown>
}

export async function saveServiceAccountConfig(input: ServiceAccountSaveInput) {
  return api.put<ServiceAccountStatus>('/api/google-calendar/service-account-config', input)
}

export async function clearServiceAccountConfig() {
  return api.delete<{ success: boolean }>('/api/google-calendar/service-account-config')
}

export type ServiceAccountTestResult = {
  ok: boolean
  reason?: 'not_configured' | 'calendar_access_denied' | 'exception'
  detail?: string
}

export async function testServiceAccountConfig() {
  return api.post<ServiceAccountTestResult>('/api/google-calendar/service-account-config/test', {})
}

// ── Calendar sharing (SA mode, no DWD required) ─────────────────────────────

export type CalendarShareRole = 'reader' | 'writer' | 'freeBusyReader'

export type CalendarShare = {
  ruleId: string
  email: string
  role: CalendarShareRole
}

export type ShareResult = {
  email: string
  ok: boolean
  ruleId?: string
  role?: CalendarShareRole
  error?: string
}

export async function listCalendarShares() {
  return api.get<CalendarShare[]>('/api/google-calendar/shares')
}

export async function shareCalendarWith(emails: string[], role: CalendarShareRole = 'reader') {
  return api.post<ShareResult[]>('/api/google-calendar/shares', { emails, role })
}

export async function revokeCalendarShare(ruleId: string) {
  return api.delete<{ success: boolean }>(
    `/api/google-calendar/shares/${encodeURIComponent(ruleId)}`
  )
}
