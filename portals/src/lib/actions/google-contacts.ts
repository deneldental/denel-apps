import { API_BASE_URL, api } from '@/lib/api-client'

export type GoogleContactsStatus = {
  /** Whether the backend has the OAuth credentials set. If false the user can't connect at all. */
  configured: boolean
  /** Whether the *current user* has a connected Google account. */
  connected: boolean
  email: string | null
  connectedAt: string | null
}

export async function getGoogleContactsStatus() {
  return api.get<GoogleContactsStatus>('/api/google-contacts/status')
}

/**
 * Begin the Google OAuth flow for Contacts. Returns a URL to redirect the
 * browser to. The backend's GET /connect issues a 302 to Google's consent
 * screen — we resolve that by setting window.location and letting the browser
 * follow redirects naturally (a credentialed fetch wouldn't follow cross-origin
 * 302s anyway, and we *want* a full page navigation here).
 *
 * OAuth credentials are SHARED with the Google Calendar integration — one
 * Google Cloud project. Configure them in Integrations → Google Calendar.
 */
export function getConnectUrl(): string {
  return `${API_BASE_URL}/api/google-contacts/connect`
}

export async function disconnectGoogleContacts() {
  return api.delete<{ disconnected: boolean }>('/api/google-contacts')
}

/** Counts returned by a push-to-Google sync run. */
export type ContactsSyncResult = {
  created: number
  updated: number
  skipped: number
  failed: number
}

/** Push CRM patients → the connected user's Google Contacts. */
export async function syncGoogleContacts() {
  return api.post<ContactsSyncResult>('/api/google-contacts/sync', {})
}
