/**
 * Google Calendar integration — per-user OAuth + outbound event sync.
 *
 * Design:
 *  - Each Framada user connects their own Google account (per-user tokens).
 *  - First cut is **outbound only**: Framada appointment changes push to Google.
 *    Inbound (Google → Framada) requires push-notification channels and lives
 *    in a follow-up.
 *  - No googleapis npm dep — we hit Google's HTTPS endpoints with `fetch()`
 *    directly. Keeps the bundle small and edge-friendly.
 *  - OAuth state is HMAC-signed (no server-side state store needed).
 *  - All sync calls are wrapped in `safeSync()` — exceptions are logged but
 *    never propagated to the appointment-handling request. A failed sync
 *    must NEVER block a Framada write.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { addSeconds } from 'date-fns'
import { eq } from 'drizzle-orm'
import { env } from '../config/env'
import { getDb } from '../db'
import {
  type appointments as appointmentsTable,
  googleCalendarEventLinks,
  googleCalendarIntegrations,
  specialists,
} from '../db/schema'
import { getActiveAuthMethod } from './google-auth-method'
import { resolveOAuthConfig } from './google-oauth-config'
import { ensureDoctorCalendar, getServiceAccountAccessToken } from './google-service-account'
import { logError, logger } from './logger'

// ── Scopes & endpoints ────────────────────────────────────────────────────────

/** Least-privilege scope: read/write events only on the user's calendars. */
export const GOOGLE_OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
].join(' ')

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3'

/** State TTL — guards against replay of stale state values. 15 min is plenty. */
const STATE_TTL_MS = 15 * 60 * 1000

// ── Configuration ────────────────────────────────────────────────────────────

export type GoogleOAuthConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

/**
 * Returns `null` when any of the three required env vars are missing.
 * Callers should respond with 503 ("Google Calendar not configured").
 */
export function getOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri }
}

// ── HMAC-signed OAuth state ──────────────────────────────────────────────────
// State carries the userId + a nonce + a timestamp, signed with BETTER_AUTH_SECRET.
// Format: base64url(payload) + "." + base64url(hmac). Self-contained, no DB row.

type StatePayload = { uid: string; nonce: string; ts: number }

function b64urlEncode(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8')
  return b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

export function signState(userId: string): string {
  const payload: StatePayload = {
    uid: userId,
    nonce: randomBytes(12).toString('hex'),
    ts: Date.now(),
  }
  const payloadEnc = b64urlEncode(JSON.stringify(payload))
  const sig = createHmac('sha256', env.BETTER_AUTH_SECRET).update(payloadEnc).digest()
  return `${payloadEnc}.${b64urlEncode(sig)}`
}

export function verifyState(
  state: string
): { ok: true; userId: string } | { ok: false; reason: string } {
  const parts = state.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed' }
  const [payloadEnc, sigEnc] = parts
  const expectedSig = createHmac('sha256', env.BETTER_AUTH_SECRET).update(payloadEnc).digest()
  const providedSig = b64urlDecode(sigEnc)
  if (expectedSig.length !== providedSig.length || !timingSafeEqual(expectedSig, providedSig)) {
    return { ok: false, reason: 'bad signature' }
  }
  let payload: StatePayload
  try {
    payload = JSON.parse(b64urlDecode(payloadEnc).toString('utf8'))
  } catch {
    return { ok: false, reason: 'unparseable payload' }
  }
  if (Date.now() - payload.ts > STATE_TTL_MS) return { ok: false, reason: 'expired' }
  if (!payload.uid) return { ok: false, reason: 'missing uid' }
  return { ok: true, userId: payload.uid }
}

// ── OAuth URLs ───────────────────────────────────────────────────────────────

export function buildAuthUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPE,
    access_type: 'offline', // returns a refresh_token
    prompt: 'consent', // forces a fresh refresh_token even if previously granted
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

// ── Token exchange & refresh ─────────────────────────────────────────────────

type TokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope: string
  token_type: string
  id_token?: string
}

export async function exchangeCodeForTokens(
  config: GoogleOAuthConfig,
  code: string
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  })
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Token exchange failed (${res.status}): ${errText}`)
  }
  return (await res.json()) as TokenResponse
}

export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Token refresh failed (${res.status}): ${errText}`)
  }
  return (await res.json()) as TokenResponse
}

/**
 * Returns an access token good for at least the next 60s. Refreshes on the
 * fly if needed and persists the new accessToken + expiry back to the DB.
 *
 * Throws if the user has no integration row or the refresh fails (e.g. the
 * user revoked access on Google's side). Callers — i.e. `syncAppointment*`
 * helpers — must `safeSync()` around this.
 */
async function getValidAccessToken(userId: string | null): Promise<{
  accessToken: string
  calendarId: string
}> {
  const db = getDb(env.DATABASE_URL)
  const method = await getActiveAuthMethod(db)

  // Service-account mode mints a token for the shared clinic calendar; the
  // userId argument is irrelevant in this mode.
  if (method === 'service_account') {
    return getServiceAccountAccessToken(db)
  }

  if (!userId) throw new Error('OAuth mode requires a userId')

  const config = await resolveOAuthConfig(db)
  if (!config) throw new Error('Google OAuth not configured')

  const [row] = await db
    .select()
    .from(googleCalendarIntegrations)
    .where(eq(googleCalendarIntegrations.userId, userId))
    .limit(1)
  if (!row) throw new Error(`No Google Calendar integration for user ${userId}`)

  // Refresh if expiring in <60s
  const expiresInSeconds = (row.tokenExpiresAt.getTime() - Date.now()) / 1000
  if (expiresInSeconds > 60) {
    return { accessToken: row.accessToken, calendarId: row.calendarId }
  }

  const tokens = await refreshAccessToken(config, row.refreshToken)
  const newExpiresAt = addSeconds(new Date(), tokens.expires_in)
  await db
    .update(googleCalendarIntegrations)
    .set({
      accessToken: tokens.access_token,
      tokenExpiresAt: newExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(googleCalendarIntegrations.userId, userId))
  return { accessToken: tokens.access_token, calendarId: row.calendarId }
}

// ── Google userinfo (just for "connected as <email>") ────────────────────────

export async function fetchUserInfo(accessToken: string): Promise<{ email: string }> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`userinfo failed (${res.status})`)
  const json = (await res.json()) as { email?: string }
  if (!json.email) throw new Error('userinfo missing email')
  return { email: json.email }
}

// ── Calendar API (events) ────────────────────────────────────────────────────

type GoogleEventPayload = {
  summary: string
  description?: string
  start: { dateTime: string; timeZone?: string }
  end: { dateTime: string; timeZone?: string }
  attendees?: Array<{ email: string }>
}

async function calendarFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = `${CALENDAR_BASE}${path}`
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

/**
 * Google rejects attendee invites from a service account that doesn't have
 * Domain-Wide Delegation. Common when the clinic isn't on Workspace at all
 * or DWD wasn't granted. We retry without attendees so the event still lands
 * in the shared calendar.
 */
function isForbiddenForServiceAccounts(text: string): boolean {
  return /forbiddenForServiceAccounts/i.test(text)
}

function withoutAttendees<T extends Partial<GoogleEventPayload>>(body: T): T {
  if (!('attendees' in body)) return body
  const { attendees: _drop, ...rest } = body
  return rest as T
}

/**
 * Search a calendar for an event whose description tags it as belonging to
 * a given Framada appointment. We embed `Denel appointment <uuid>` into
 * every event description we create, so this lookup recovers events whose
 * link rows didn't make it into the DB (e.g. the pre-fix FK violation in
 * SA mode). Returns the Google event id, or null when nothing matches.
 *
 * Uses Google's free-text `q` search across event fields — UUIDs are unique
 * enough to make false positives effectively impossible.
 */
async function findEventOnCalendar(
  accessToken: string,
  calendarId: string,
  appointmentId: string
): Promise<string | null> {
  const res = await calendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events?q=${encodeURIComponent(
      appointmentId
    )}&maxResults=10&showDeleted=false`
  )
  if (!res.ok) return null
  const json = (await res.json().catch(() => null)) as {
    items?: Array<{ id?: string; description?: string }>
  } | null
  if (!json?.items?.length) return null
  // Tighten the match — q does substring matches but description embeds the
  // full uuid, so check explicitly to dodge any unlucky false positives.
  for (const item of json.items) {
    if (item.id && item.description?.includes(appointmentId)) return item.id
  }
  return null
}

async function createEvent(
  accessToken: string,
  calendarId: string,
  body: GoogleEventPayload
): Promise<string> {
  const tryCreate = (payload: GoogleEventPayload, sendUpdates: boolean) =>
    calendarFetch(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events${sendUpdates ? '?sendUpdates=all' : ''}`,
      { method: 'POST', body: JSON.stringify(payload) }
    )

  let res = await tryCreate(body, true)
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    if (res.status === 403 && isForbiddenForServiceAccounts(errText) && body.attendees) {
      logger.warn(
        '[google-calendar] SA cannot invite attendees (no DWD) — retrying without attendees'
      )
      res = await tryCreate(withoutAttendees(body), false)
      if (!res.ok) {
        const retryText = await res.text().catch(() => '')
        throw new Error(`createEvent failed after attendee retry (${res.status}): ${retryText}`)
      }
    } else {
      throw new Error(`createEvent failed (${res.status}): ${errText}`)
    }
  }
  const json = (await res.json()) as { id?: string }
  if (!json.id) throw new Error('createEvent: missing id in response')
  return json.id
}

async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: Partial<GoogleEventPayload>
): Promise<void> {
  const tryPatch = (payload: Partial<GoogleEventPayload>, sendUpdates: boolean) =>
    calendarFetch(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${
        sendUpdates ? '?sendUpdates=all' : ''
      }`,
      { method: 'PATCH', body: JSON.stringify(payload) }
    )

  let res = await tryPatch(body, true)
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    if (res.status === 403 && isForbiddenForServiceAccounts(errText) && body.attendees) {
      logger.warn(
        '[google-calendar] SA cannot invite attendees (no DWD) — retrying patch without attendees'
      )
      res = await tryPatch(withoutAttendees(body), false)
      if (res.ok) return
      const retryText = await res.text().catch(() => '')
      throw new Error(`patchEvent failed after attendee retry (${res.status}): ${retryText}`)
    }
    throw new Error(`patchEvent failed (${res.status}): ${errText}`)
  }
}

async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const res = await calendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: 'DELETE' }
  )
  // 410 Gone = already deleted (or user removed it manually) — treat as success.
  if (!res.ok && res.status !== 410) {
    const errText = await res.text().catch(() => '')
    throw new Error(`deleteEvent failed (${res.status}): ${errText}`)
  }
}

// ── Token revocation ────────────────────────────────────────────────────────

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  // Revoke any token; the refresh token revocation also invalidates derived
  // access tokens. Errors are swallowed — disconnect should always succeed
  // locally even if Google rejects the revocation.
  try {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(refreshToken)}`, {
      method: 'POST',
    })
  } catch (err) {
    logger.warn({ err }, '[google-calendar] revoke failed (continuing)')
  }
}

// ── Appointment → Google event mapping ────────────────────────────────────────

type AppointmentRow = typeof appointmentsTable.$inferSelect
type EnrichedAppointment = AppointmentRow & {
  patientName?: string
  patientEmail?: string | null
  doctorName?: string
  /** Used as an attendee on the GCal event so the doctor's own calendar
   *  receives the appointment (via Google's invite mechanism). */
  doctorEmail?: string | null
}

/** Default appointment duration when `durationMinutes` is missing/zero. */
const DEFAULT_DURATION_MIN = 30

/** Status values that should result in a calendar event being absent. */
const CANCELLED_STATUSES = new Set(['cancelled', 'no_show', 'no-show'])

function buildEventPayload(appt: EnrichedAppointment): GoogleEventPayload {
  const start = new Date(appt.date)
  const duration = appt.durationMinutes || DEFAULT_DURATION_MIN
  const end = new Date(start.getTime() + duration * 60_000)
  const summary = appt.patientName
    ? `${appt.type ?? 'Appointment'} — ${appt.patientName}`
    : (appt.type ?? 'Appointment')
  const descriptionLines = [
    appt.doctorName ? `Provider: ${appt.doctorName}` : null,
    appt.notes ? `Notes: ${appt.notes}` : null,
    `Denel appointment ${appt.id}`,
  ].filter(Boolean)
  const payload: GoogleEventPayload = {
    summary,
    description: descriptionLines.join('\n'),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  }
  // Invite both the patient (so they get a confirmation email) and the doctor
  // (so the event also appears in their own primary Google Calendar). The
  // attendees field works without DWD — Google looks the addresses up and
  // surfaces the event in their calendars when they accept the invite.
  const attendees: Array<{ email: string }> = []
  if (appt.patientEmail) attendees.push({ email: appt.patientEmail })
  if (appt.doctorEmail) attendees.push({ email: appt.doctorEmail })
  if (attendees.length > 0) payload.attendees = attendees
  return payload
}

// ── Public sync API ──────────────────────────────────────────────────────────
// All sync functions are *side-effect only* — they never throw. Failures are
// logged. The caller (an appointment-mutation handler) must NOT await them in
// a way that delays the HTTP response — fire-and-forget.

function safeSync(label: string, fn: () => Promise<void>): void {
  void fn().catch((err) => {
    logError(err, { context: `[google-calendar] ${label}` })
  })
}

/**
 * Try to find an existing event link for an appointment. Returns null if
 * there isn't one yet — caller should create.
 *
 * We match by `appointmentId` only. In OAuth mode we sync to exactly one
 * user (the assigned doctor's), and in SA mode we sync to exactly one
 * calendar (per-doctor or the shared fallback) — so per-appointment there
 * is never more than one row in practice. Matching by appointmentId also
 * handles the transition where pre-fix SA rows carry a (non-FK-violating)
 * userId and post-fix SA rows carry NULL — both look up the same way.
 *
 * `_userId` is retained in the signature for callers passing it through but
 * is no longer used for the query.
 */
async function findEventLink(appointmentId: string, _userId: string | null) {
  const db = getDb(env.DATABASE_URL)
  const [link] = await db
    .select()
    .from(googleCalendarEventLinks)
    .where(eq(googleCalendarEventLinks.appointmentId, appointmentId))
    .limit(1)
  return link ?? null
}

/**
 * Resolve how to sync an appointment — including the target calendarId.
 *
 *  - OAuth mode: writes to the user's own calendar (typically "primary").
 *    Requires the doctor to have a linked user with a GCal integration.
 *  - Service-account mode: writes to a PER-DOCTOR calendar that the SA
 *    auto-provisions on first sync and shares with the doctor (reader).
 *    This keeps each doctor's view scoped to only their own appointments
 *    without needing Workspace + DWD.
 */
type SyncContext =
  | { method: 'oauth'; userId: string; calendarId: string }
  | { method: 'sa'; linkUserId: string | null; calendarId: string }

async function resolveSyncContext(appt: AppointmentRow): Promise<SyncContext | null> {
  const db = getDb(env.DATABASE_URL)
  const method = await getActiveAuthMethod(db)

  // doctors row → optional specialist → optional user. After the unification
  // migration (0048) most doctors are sourced from a specialist; legacy
  // staff-sourced rows still work via doctors.userId.
  const doctorRow = await db.query.doctors.findFirst({
    where: (d, { eq: eqOp }) => eqOp(d.id, appt.doctorId),
    with: { specialist: { with: { user: { columns: { email: true } } } } },
  })
  if (!doctorRow) return null

  const linkUserId = doctorRow.userId ?? doctorRow.specialist?.userId ?? null

  if (method === 'service_account') {
    // Auto-provision a per-doctor calendar if we don't have one yet.
    if (!doctorRow.specialist) {
      // Legacy doctors row with no specialist link — fall back to the SA's
      // configured shared calendar so the appointment still syncs somewhere.
      const sa = await getServiceAccountAccessToken(db)
      return { method: 'sa', linkUserId, calendarId: sa.calendarId }
    }
    const s = doctorRow.specialist
    const calendarId = await ensureDoctorCalendar(
      db,
      {
        id: s.id,
        name: s.name,
        gcalCalendarId: s.gcalCalendarId,
        contactEmail: s.contactEmail,
        user: s.user ? { email: s.user.email ?? null } : null,
      },
      async (specialistId, newCalendarId) => {
        await db
          .update(specialists)
          .set({ gcalCalendarId: newCalendarId, updatedAt: new Date() })
          .where(eq(specialists.id, specialistId))
      }
    )
    return { method: 'sa', linkUserId, calendarId }
  }

  if (!linkUserId) return null
  const [integration] = await db
    .select({
      userId: googleCalendarIntegrations.userId,
      calendarId: googleCalendarIntegrations.calendarId,
    })
    .from(googleCalendarIntegrations)
    .where(eq(googleCalendarIntegrations.userId, linkUserId))
    .limit(1)
  if (!integration) return null
  return { method: 'oauth', userId: integration.userId, calendarId: integration.calendarId }
}

/** Pick the userId to record on the event-link row.
 *
 *  OAuth mode: the integration row exists for `ctx.userId`, so the FK is
 *  safe and we keep that user's id for filtering.
 *
 *  Service-account mode: the doctor's user may NOT have an integration row
 *  (they don't have to connect their own Google account in SA mode). The FK
 *  on `google_calendar_event_links.userId → google_calendar_integrations.userId`
 *  would then reject the insert with a foreign-key violation — silently,
 *  because `safeSync` swallows the error — leaving the GCal event created
 *  but no link row in the DB. The sync-status endpoint then reports
 *  "sync pending or failed" even though the event is sitting on the
 *  calendar.
 *
 *  So in SA mode we always write `userId = null`. The schema already allows
 *  it; the comment on the column documents this exact case.
 */
function linkUserIdFromCtx(ctx: SyncContext): string | null {
  return ctx.method === 'oauth' ? ctx.userId : null
}

/**
 * Sync after an appointment is created. Creates the Google event and saves
 * the link. No-op if the doctor isn't connected.
 */
export function syncAppointmentCreated(appt: EnrichedAppointment): void {
  safeSync(`create appt=${appt.id}`, async () => {
    const ctx = await resolveSyncContext(appt)
    if (!ctx) return
    if (CANCELLED_STATUSES.has(appt.status)) return
    const { accessToken } = await getValidAccessToken(ctx.method === 'oauth' ? ctx.userId : null)
    // ctx.calendarId is the doctor-scoped destination (per-doctor in SA mode;
    // user's own calendar in OAuth mode) — NOT the SA's default config calendar.
    const eventId = await createEvent(accessToken, ctx.calendarId, buildEventPayload(appt))
    const db = getDb(env.DATABASE_URL)
    await db.insert(googleCalendarEventLinks).values({
      appointmentId: appt.id,
      userId: linkUserIdFromCtx(ctx),
      calendarId: ctx.calendarId,
      googleEventId: eventId,
    })
  })
}

/**
 * Awaitable version of the update sync. Same body as `syncAppointmentUpdated`
 * minus the `safeSync` wrapper, so manual flows (e.g. the dialog's Re-sync
 * button) can `await` the result and report success/failure to the caller.
 * The fire-and-forget export below delegates to this.
 */
export async function syncAppointmentUpdatedAsync(appt: EnrichedAppointment): Promise<void> {
  const ctx = await resolveSyncContext(appt)
  if (!ctx) return
  const linkUserId = linkUserIdFromCtx(ctx)
  const { accessToken } = await getValidAccessToken(ctx.method === 'oauth' ? ctx.userId : null)
  const calendarId = ctx.calendarId
  const existing = await findEventLink(appt.id, linkUserId)

  if (CANCELLED_STATUSES.has(appt.status)) {
    if (existing) {
      await deleteEvent(accessToken, calendarId, existing.googleEventId)
      const db = getDb(env.DATABASE_URL)
      await db.delete(googleCalendarEventLinks).where(eq(googleCalendarEventLinks.id, existing.id))
    }
    return
  }

  if (existing) {
    await patchEvent(accessToken, calendarId, existing.googleEventId, buildEventPayload(appt))
    const db = getDb(env.DATABASE_URL)
    await db
      .update(googleCalendarEventLinks)
      // calendarId is set in case an older row pre-dates the column.
      // For rows that already had it, this is a no-op write to the same value.
      .set({ syncedAt: new Date(), calendarId })
      .where(eq(googleCalendarEventLinks.id, existing.id))
  } else {
    // No link row in our DB. Before creating a brand-new event (which
    // would duplicate orphans from the pre-fix SA FK bug), see if a
    // matching event already exists on the calendar. If so, patch it
    // and adopt it; otherwise create a fresh one.
    const adopted = await findEventOnCalendar(accessToken, calendarId, appt.id)
    const eventId = adopted ?? (await createEvent(accessToken, calendarId, buildEventPayload(appt)))
    if (adopted) {
      // Make sure the event content reflects the latest appointment data.
      await patchEvent(accessToken, calendarId, adopted, buildEventPayload(appt))
    }
    const db = getDb(env.DATABASE_URL)
    await db
      .insert(googleCalendarEventLinks)
      .values({ appointmentId: appt.id, userId: linkUserId, calendarId, googleEventId: eventId })
  }
}

/**
 * Sync after an appointment is updated. PATCHes the existing event in place,
 * or creates one if no link exists yet (e.g. the user connected after the
 * appointment was already created).
 *
 * If the appointment moved to a cancelled-style status, we delete the event.
 */
export function syncAppointmentUpdated(appt: EnrichedAppointment): void {
  safeSync(`update appt=${appt.id}`, () => syncAppointmentUpdatedAsync(appt))
}

/**
 * Sync after an appointment is deleted.
 *
 * Unlike `syncAppointmentCreated/Updated`, this one returns a Promise — the
 * caller MUST `await` it BEFORE deleting the appointment. Why: the foreign-key
 * `onDelete: 'cascade'` on `google_calendar_event_links.appointment_id` will
 * wipe the link rows the moment the appointment is deleted, leaving the sync
 * helper with nothing to look up. So we capture a snapshot of the links here
 * synchronously, then fire-and-forget the actual Google API DELETEs.
 *
 * After the call returns, the appointment can be safely deleted — the DB
 * cleanup of `googleCalendarEventLinks` rows happens automatically via cascade.
 */
export async function syncAppointmentDeleted(appointmentId: string): Promise<void> {
  const db = getDb(env.DATABASE_URL)
  const links = await db
    .select()
    .from(googleCalendarEventLinks)
    .where(eq(googleCalendarEventLinks.appointmentId, appointmentId))

  if (links.length === 0) return

  // We need to know WHICH calendar each event lives in. The appointment row
  // (not yet deleted by the caller) lets us re-resolve the destination via
  // resolveSyncContext, which knows about per-doctor calendars in SA mode.
  const appt = await db.query.appointments.findFirst({
    where: (a, { eq: eqOp }) => eqOp(a.id, appointmentId),
  })
  if (!appt) return

  safeSync(`delete appt=${appointmentId}`, async () => {
    const ctx = await resolveSyncContext(appt)
    if (!ctx) return
    const { accessToken } = await getValidAccessToken(ctx.method === 'oauth' ? ctx.userId : null)
    for (const link of links) {
      try {
        await deleteEvent(accessToken, ctx.calendarId, link.googleEventId)
      } catch (err) {
        logError(err, { context: `[google-calendar] delete link ${link.id} failed` })
      }
    }
  })
}

/**
 * Enrich an appointment row with patient name/email + doctor name. Loaders
 * inside the appointment routes usually already have these fields loaded —
 * but the sync entry points accept either bare or enriched rows so callers
 * can pass whatever they have. If anything's missing we fall back to a leaner
 * description.
 */
export async function enrichAppointment(appt: AppointmentRow): Promise<EnrichedAppointment> {
  const db = getDb(env.DATABASE_URL)
  const detail = await db.query.appointments.findFirst({
    where: (a, { eq: eqOp }) => eqOp(a.id, appt.id),
    with: {
      patient: { columns: { name: true, email: true } },
      doctor: {
        with: {
          user: { columns: { name: true, email: true } },
          // Specialist-sourced doctors carry their identity here.
          specialist: {
            with: { user: { columns: { name: true, email: true } } },
          },
        },
      },
    },
  })

  // Pick doctor name + email from whichever source is populated.
  const doc = detail?.doctor
  const docName = doc?.user?.name ?? doc?.specialist?.user?.name ?? doc?.specialist?.name
  const docEmail =
    doc?.user?.email ?? doc?.specialist?.user?.email ?? doc?.specialist?.contactEmail ?? null

  return {
    ...appt,
    patientName: detail?.patient?.name,
    patientEmail: detail?.patient?.email ?? null,
    doctorName: docName,
    doctorEmail: docEmail,
  }
}
