/**
 * Google Calendar OAuth routes — per-user connect, callback, disconnect, status.
 *
 * Flow:
 *   1. Frontend "Connect" → GET  /api/google-calendar/connect (signed-in)
 *      → 302 to Google's consent screen with HMAC-signed state.
 *   2. Google → GET  /api/google-calendar/callback?code=...&state=...
 *      → exchanges code, stores tokens, 302 back to the portal config page.
 *   3. Frontend re-fetches GET /api/google-calendar/status to render connected
 *      state.
 *   4. Frontend "Disconnect" → DELETE /api/google-calendar — revokes the
 *      refresh token + deletes the integration row + cascades event links.
 *
 * Permissions: `settings:read` for GET /status (everyone can see whether they
 * are connected). `/connect`, `/callback`, `/disconnect` only require an
 * authenticated session — connecting your OWN Google account is not gated
 * behind clinic-admin permissions.
 */

import { addSeconds } from 'date-fns'
import { count, eq, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { env } from '../config/env'
import { getDb } from '../db'
import {
  appointments,
  doctors,
  googleCalendarEventLinks,
  googleCalendarIntegrations,
} from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { getActiveAuthMethod, setActiveAuthMethod } from '../lib/google-auth-method'
import {
  buildAuthUrl,
  enrichAppointment,
  exchangeCodeForTokens,
  fetchUserInfo,
  revokeRefreshToken,
  signState,
  syncAppointmentUpdatedAsync,
  verifyState,
} from '../lib/google-calendar'
import {
  clearOAuthConfig,
  getOAuthConfigStatus,
  resolveOAuthConfig,
  saveOAuthConfig,
} from '../lib/google-oauth-config'
import {
  clearServiceAccountConfig,
  getServiceAccountStatus,
  invalidateTokenCache,
  listCalendarShares,
  resolveServiceAccountConfig,
  revokeCalendarShare,
  saveServiceAccountConfig,
  shareCalendarWith,
} from '../lib/google-service-account'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES, ROLES } from '../lib/modules'
import { portalLink } from '../lib/public-urls'
import { getCurrentUser } from '../lib/rbac'
import { denyUnless } from '../lib/route-access'
import type { HonoEnv } from '../lib/types'

const googleCalendarApp = new Hono<HonoEnv>()

/** Where to send the user after callback: the integrations page of the clinic portal. */
function getPortalReturnUrl(): string {
  return portalLink('/integrations/google-calendar')
}

// ── GET /status ─────────────────────────────────────────────────────────────
// Whether the *current user* has connected Google Calendar.
googleCalendarApp.get('/status', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const denied = await denyUnless(c, user.id, { apps: ['portal'] })
  if (denied) return denied

  const dbForCfg = getDb(env.DATABASE_URL)
  const config = await resolveOAuthConfig(dbForCfg)
  if (!config) {
    return c.json({
      success: true,
      data: { configured: false, connected: false, email: null, connectedAt: null },
    })
  }

  const db = getDb(env.DATABASE_URL)
  const [row] = await db
    .select({
      email: googleCalendarIntegrations.connectedEmail,
      connectedAt: googleCalendarIntegrations.connectedAt,
      calendarId: googleCalendarIntegrations.calendarId,
    })
    .from(googleCalendarIntegrations)
    .where(eq(googleCalendarIntegrations.userId, user.id))
    .limit(1)

  return c.json({
    success: true,
    data: {
      configured: true,
      connected: !!row,
      email: row?.email ?? null,
      calendarId: row?.calendarId ?? null,
      connectedAt: row?.connectedAt ?? null,
    },
  })
})

// ── GET /appointment-sync/:appointmentId ────────────────────────────────────
// Reports whether a specific appointment is mirrored to Google Calendar.
// Used by the appointment detail dialog so the admin can see at a glance
// whether the doctor's GCal has the event.
googleCalendarApp.get('/appointment-sync/:appointmentId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const denied = await denyUnless(c, user.id, {
    apps: ['portal'],
    anyOf: [[MODULES.APPOINTMENTS, ACTIONS.READ]],
  })
  if (denied) return denied

  const appointmentId = c.req.param('appointmentId')
  const db = getDb(env.DATABASE_URL)

  // "configured" is true when the active method has everything it needs:
  // - oauth → OAuth credentials present
  // - service_account → SA config present
  const method = await getActiveAuthMethod(db)
  const configured =
    method === 'service_account'
      ? !!(await resolveServiceAccountConfig(db))
      : !!(await resolveOAuthConfig(db))

  const appt = await db
    .select({ doctorId: appointments.doctorId })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1)
  if (appt.length === 0) {
    return c.json({
      success: true,
      data: { method, configured, doctorConnected: false, eventLinked: false, syncedAt: null },
    })
  }

  // Resolve the link userId same way the sync helper does — doctors.userId
  // OR doctors.specialist.userId. Either may be null (external specialist).
  const doctorRow = await db.query.doctors.findFirst({
    where: eq(doctors.id, appt[0].doctorId),
    with: { specialist: true },
  })
  const linkUserId = doctorRow?.userId ?? doctorRow?.specialist?.userId ?? null

  // doctorConnected:
  //   - SA mode → always reflects whether the SA itself is configured
  //   - OAuth mode → does the linked user have an integration row?
  let doctorConnected: boolean
  if (method === 'service_account') {
    doctorConnected = configured
  } else if (!linkUserId) {
    doctorConnected = false
  } else {
    const [integrationRow] = await db
      .select({ userId: googleCalendarIntegrations.userId })
      .from(googleCalendarIntegrations)
      .where(eq(googleCalendarIntegrations.userId, linkUserId))
      .limit(1)
    doctorConnected = !!integrationRow
  }

  // Find the event-link row. `appointmentId` is the natural key — userId on
  // the link is just metadata about which integration wrote the event (and
  // can legitimately be NULL in SA mode for specialist-only doctors). The
  // old query keyed off userId too, which silently missed perfectly-synced
  // rows whose stored userId didn't match the freshly-resolved linkUserId.
  const linkQuery = await db
    .select({ syncedAt: googleCalendarEventLinks.syncedAt })
    .from(googleCalendarEventLinks)
    .where(eq(googleCalendarEventLinks.appointmentId, appointmentId))
    .limit(1)
  const linkRow = linkQuery[0]

  return c.json({
    success: true,
    data: {
      method,
      configured,
      doctorConnected,
      eventLinked: !!linkRow,
      syncedAt: linkRow?.syncedAt ?? null,
    },
  })
})

// ── GET /per-doctor-status ──────────────────────────────────────────────────
// Diagnostic for SA mode: one row per doctor showing whether a dedicated
// calendar has been provisioned (`specialists.gcal_calendar_id`), the
// calendar id in use, and where the doctor's events are actually landing
// (joined through `google_calendar_event_links`). Admins use this to spot
// two failure modes:
//
//   1. Two doctors sharing the same `calendar_id` — never auto-provisioned
//      and currently going to the SA fallback. Fix the affected `doctors`
//      row by linking a `specialist_id`, or rerun sync after wiping
//      `gcal_calendar_id` to force re-provisioning.
//
//   2. Doctors with no `specialist_id` link (legacy doctors rows). Their
//      events all bunch onto the SA's shared calendar.
googleCalendarApp.get('/per-doctor-status', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  // Admin-only — same gate as the rest of the integrations surface.
  if (user.roleId !== ROLES.ADMIN) return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(env.DATABASE_URL)

  // Per-doctor aggregates from `google_calendar_event_links`. LEFT-JOIN on
  // appointments so a calendar that no longer has any active appointments
  // (deleted) still shows zero events instead of vanishing.
  const eventStats = await db
    .select({
      doctorId: appointments.doctorId,
      calendarId: googleCalendarEventLinks.calendarId,
      eventCount: count(googleCalendarEventLinks.id),
      lastSyncedAt: max(googleCalendarEventLinks.syncedAt),
    })
    .from(googleCalendarEventLinks)
    .innerJoin(appointments, eq(googleCalendarEventLinks.appointmentId, appointments.id))
    .groupBy(appointments.doctorId, googleCalendarEventLinks.calendarId)

  // One row per (doctor, calendar) pair. Most doctors have one calendar; if
  // a doctor was migrated mid-flight they could have two — that itself is a
  // useful warning.
  const eventByDoctor = new Map<
    string,
    Array<{ calendarId: string | null; eventCount: number; lastSyncedAt: Date | null }>
  >()
  for (const row of eventStats) {
    const list = eventByDoctor.get(row.doctorId) ?? []
    list.push({
      calendarId: row.calendarId,
      eventCount: Number(row.eventCount),
      lastSyncedAt: row.lastSyncedAt,
    })
    eventByDoctor.set(row.doctorId, list)
  }

  // Pull every doctor row + specialist link. We deliberately walk the
  // `doctors` table (the FK target on appointments) rather than specialists
  // directly — that catches legacy rows with no specialist link.
  const doctorRows = await db.query.doctors.findMany({
    with: {
      specialist: { columns: { id: true, name: true, gcalCalendarId: true } },
    },
    orderBy: (d, { asc }) => [asc(d.id)],
  })

  // Detect calendars used by more than one doctor — the bug case.
  const calendarUsage = new Map<string, Set<string>>()
  for (const [doctorId, rows] of eventByDoctor) {
    for (const r of rows) {
      if (!r.calendarId) continue
      const owners = calendarUsage.get(r.calendarId) ?? new Set()
      owners.add(doctorId)
      calendarUsage.set(r.calendarId, owners)
    }
  }

  const sa = await resolveServiceAccountConfig(db)
  const sharedFallbackCalendarId = sa?.calendarId ?? null

  type Row = {
    doctorId: string
    specialistId: string | null
    doctorName: string
    /** Calendar id stored on the specialist row (provisioned destination). */
    provisionedCalendarId: string | null
    /** Distinct calendar(s) appointments actually landed on. */
    observedCalendarIds: string[]
    eventCount: number
    lastSyncedAt: string | null
    warnings: Array<
      | 'no_specialist_link'
      | 'not_provisioned'
      | 'shared_with_fallback'
      | 'shared_with_other_doctor'
      | 'observed_mismatch_with_provisioned'
    >
  }

  const data: Row[] = doctorRows.map((d) => {
    const ev = eventByDoctor.get(d.id) ?? []
    const observedCalendarIds = Array.from(
      new Set(ev.map((r) => r.calendarId).filter((id): id is string => !!id))
    )
    const eventCount = ev.reduce((s, r) => s + r.eventCount, 0)
    const lastSyncedAt =
      ev
        .reduce<Date | null>((acc, r) => {
          if (!r.lastSyncedAt) return acc
          if (!acc) return r.lastSyncedAt
          return r.lastSyncedAt > acc ? r.lastSyncedAt : acc
        }, null)
        ?.toISOString() ?? null

    const provisionedCalendarId = d.specialist?.gcalCalendarId ?? null
    const warnings: Row['warnings'] = []
    if (!d.specialistId) warnings.push('no_specialist_link')
    if (d.specialistId && !provisionedCalendarId && eventCount === 0) {
      warnings.push('not_provisioned')
    }
    if (sharedFallbackCalendarId && observedCalendarIds.includes(sharedFallbackCalendarId)) {
      warnings.push('shared_with_fallback')
    }
    for (const cid of observedCalendarIds) {
      const owners = calendarUsage.get(cid)
      if (owners && owners.size > 1) {
        warnings.push('shared_with_other_doctor')
        break
      }
    }
    if (
      provisionedCalendarId &&
      observedCalendarIds.length > 0 &&
      !observedCalendarIds.includes(provisionedCalendarId)
    ) {
      warnings.push('observed_mismatch_with_provisioned')
    }

    return {
      doctorId: d.id,
      specialistId: d.specialistId ?? null,
      doctorName: d.specialist?.name ?? '(unknown doctor)',
      provisionedCalendarId,
      observedCalendarIds,
      eventCount,
      lastSyncedAt,
      warnings,
    }
  })

  return c.json({
    success: true,
    data: {
      sharedFallbackCalendarId,
      rows: data,
    },
  })
})

// ── POST /appointment-sync/:appointmentId/resync ────────────────────────────
// Manual re-sync trigger from the appointment detail dialog. Waits for the
// sync to complete (unlike the fire-and-forget auto-syncs in the routes)
// so the caller can show a concrete success/failure toast. Idempotent —
// the underlying helper PATCHes an existing event or adopts an orphan
// found by description tag before falling back to creating a new event.
googleCalendarApp.post('/appointment-sync/:appointmentId/resync', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const denied = await denyUnless(c, user.id, {
    apps: ['portal'],
    anyOf: [[MODULES.APPOINTMENTS, ACTIONS.UPDATE]],
  })
  if (denied) return denied

  const appointmentId = c.req.param('appointmentId')
  const db = getDb(env.DATABASE_URL)
  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, appointmentId),
  })
  if (!appt) return c.json({ error: 'Appointment not found' }, 404)

  try {
    const enriched = await enrichAppointment(appt)
    await syncAppointmentUpdatedAsync(enriched)
    return c.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed'
    logError(err, { appointmentId, action: 'gcal_resync', userId: user.id })
    return c.json({ error: msg }, 500)
  }
})

// ── GET /connect ────────────────────────────────────────────────────────────
// Redirects the user to Google's consent screen with HMAC-signed state.
googleCalendarApp.get('/connect', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(env.DATABASE_URL)
  const config = await resolveOAuthConfig(db)
  if (!config) {
    return c.json(
      {
        error:
          'Google Calendar OAuth is not configured. Ask an admin to configure it in Integrations → Google Calendar.',
      },
      409
    )
  }

  const state = signState(user.id)
  return c.redirect(buildAuthUrl(config, state))
})

// ── GET /callback ───────────────────────────────────────────────────────────
// Google → us. Exchanges the auth code for tokens and persists them.
googleCalendarApp.get('/callback', async (c) => {
  const dbForCallback = getDb(env.DATABASE_URL)
  const config = await resolveOAuthConfig(dbForCallback)
  if (!config) {
    return c.redirect(`${getPortalReturnUrl()}?error=not_configured`)
  }

  // Google may return an error (user denied consent, etc.)
  const googleError = c.req.query('error')
  if (googleError) {
    return c.redirect(`${getPortalReturnUrl()}?error=${encodeURIComponent(googleError)}`)
  }

  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) {
    return c.redirect(`${getPortalReturnUrl()}?error=missing_code_or_state`)
  }

  const verified = verifyState(state)
  if (!verified.ok) {
    return c.redirect(`${getPortalReturnUrl()}?error=${encodeURIComponent(verified.reason)}`)
  }

  try {
    const tokens = await exchangeCodeForTokens(config, code)
    if (!tokens.refresh_token) {
      // Refresh token only returned on first consent (prompt=consent forces it,
      // but if the user previously authorized this app with another `prompt`
      // setting, Google might omit it). Treat as a hard error so callers don't
      // silently end up with a non-refreshable token.
      return c.redirect(`${getPortalReturnUrl()}?error=no_refresh_token`)
    }
    const { email } = await fetchUserInfo(tokens.access_token)
    const tokenExpiresAt = addSeconds(new Date(), tokens.expires_in)

    const db = dbForCallback
    // Upsert — re-connecting replaces the row in place. We've already
    // attempted to revoke any prior refresh token on Disconnect; if the user
    // is re-connecting without first disconnecting, that's fine — Google will
    // happily issue new tokens.
    const existing = await db
      .select({ userId: googleCalendarIntegrations.userId })
      .from(googleCalendarIntegrations)
      .where(eq(googleCalendarIntegrations.userId, verified.userId))
      .limit(1)

    if (existing.length > 0) {
      await db
        .update(googleCalendarIntegrations)
        .set({
          connectedEmail: email,
          scope: tokens.scope,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(googleCalendarIntegrations.userId, verified.userId))
    } else {
      await db.insert(googleCalendarIntegrations).values({
        userId: verified.userId,
        connectedEmail: email,
        scope: tokens.scope,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt,
      })
    }

    return c.redirect(`${getPortalReturnUrl()}?connected=1`)
  } catch (err) {
    logError(err, { context: '[google-calendar/callback] failed' })
    return c.redirect(`${getPortalReturnUrl()}?error=token_exchange_failed`)
  }
})

// ── DELETE / ────────────────────────────────────────────────────────────────
// Disconnect the current user. Revokes the refresh token on Google's side too.
googleCalendarApp.delete('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(env.DATABASE_URL)
  const [row] = await db
    .select({ refreshToken: googleCalendarIntegrations.refreshToken })
    .from(googleCalendarIntegrations)
    .where(eq(googleCalendarIntegrations.userId, user.id))
    .limit(1)

  if (row) {
    await revokeRefreshToken(row.refreshToken)
    await db
      .delete(googleCalendarIntegrations)
      .where(eq(googleCalendarIntegrations.userId, user.id))
    // Cascade clears google_calendar_event_links rows automatically.
  }

  return c.json({ success: true, data: { disconnected: true } })
})

// ── Admin-only OAuth config CRUD ─────────────────────────────────────────────

function isAdmin(roleId: string | null | undefined): boolean {
  return roleId === ROLES.ADMIN
}

// GET /oauth-config — admin sees the current config without ever seeing the secret.
googleCalendarApp.get('/oauth-config', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  try {
    const db = getDb(env.DATABASE_URL)
    const status = await getOAuthConfigStatus(db)
    return c.json({ success: true, data: status })
  } catch (error) {
    logError(error, { route: 'google-calendar.oauth-config.get', userId: user.id })
    return c.json({ error: 'Failed to read config', code: 'OAUTH_CONFIG_READ_FAILED' }, 500)
  }
})

// PUT /oauth-config — save / update. clientSecret omitted = keep existing.
googleCalendarApp.put('/oauth-config', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    clientId?: string
    clientSecret?: string | null
    redirectUri?: string
  }

  const clientId = (body.clientId ?? '').trim()
  const redirectUri = (body.redirectUri ?? '').trim()
  const clientSecret =
    typeof body.clientSecret === 'string' && body.clientSecret.length > 0 ? body.clientSecret : null

  if (!clientId) {
    return c.json({ error: 'clientId is required', code: 'INVALID_CLIENT_ID' }, 400)
  }
  if (!redirectUri || !/^https?:\/\//.test(redirectUri)) {
    return c.json(
      { error: 'redirectUri must be an http(s) URL', code: 'INVALID_REDIRECT_URI' },
      400
    )
  }

  try {
    const db = getDb(env.DATABASE_URL)
    c.set('skipAudit', true)
    await saveOAuthConfig(db, { clientId, clientSecret, redirectUri }, user.id)
    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'integrations',
      entityId: 'google_oauth_config',
      entityName: 'Google OAuth config',
      // Never log the secret value — just whether it was rotated.
      changes: { clientId, redirectUri, secretRotated: clientSecret !== null },
    })
    const status = await getOAuthConfigStatus(db)
    return c.json({ success: true, data: status })
  } catch (error) {
    logError(error, { route: 'google-calendar.oauth-config.put', userId: user.id })
    return c.json({ error: 'Failed to save config', code: 'OAUTH_CONFIG_SAVE_FAILED' }, 500)
  }
})

// ── Active auth method toggle ────────────────────────────────────────────────

// GET /auth-method — anyone authenticated can read which method is active
// (drives the connect-card UX for doctors).
googleCalendarApp.get('/auth-method', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  try {
    const db = getDb(env.DATABASE_URL)
    const method = await getActiveAuthMethod(db)
    return c.json({ success: true, data: { method } })
  } catch (error) {
    logError(error, { route: 'google-calendar.auth-method.get', userId: user.id })
    return c.json({ error: 'Failed to read method', code: 'AUTH_METHOD_READ_FAILED' }, 500)
  }
})

// PUT /auth-method — admin toggles which one drives event sync.
googleCalendarApp.put('/auth-method', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as { method?: string }
  const method = body.method
  if (method !== 'oauth' && method !== 'service_account') {
    return c.json(
      { error: "method must be 'oauth' or 'service_account'", code: 'INVALID_METHOD' },
      400
    )
  }

  try {
    const db = getDb(env.DATABASE_URL)
    c.set('skipAudit', true)
    await setActiveAuthMethod(db, method, user.id)
    invalidateTokenCache()
    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'integrations',
      entityId: 'google_calendar_auth_method',
      entityName: `Google Calendar auth method → ${method}`,
      changes: { method },
    })
    return c.json({ success: true, data: { method } })
  } catch (error) {
    logError(error, { route: 'google-calendar.auth-method.put', userId: user.id })
    return c.json({ error: 'Failed to set method', code: 'AUTH_METHOD_SET_FAILED' }, 500)
  }
})

// ── Service-account config CRUD ──────────────────────────────────────────────

googleCalendarApp.get('/service-account-config', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  try {
    const db = getDb(env.DATABASE_URL)
    const status = await getServiceAccountStatus(db)
    return c.json({ success: true, data: status })
  } catch (error) {
    logError(error, { route: 'google-calendar.sa-config.get', userId: user.id })
    return c.json({ error: 'Failed to read config', code: 'SA_CONFIG_READ_FAILED' }, 500)
  }
})

googleCalendarApp.put('/service-account-config', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  // Accept either explicit fields or a parsed Google JSON key file under
  // `jsonKey`. The JSON form is the common case — admin pastes the file
  // they downloaded from GCP and we extract clientEmail + privateKey.
  const body = (await c.req.json().catch(() => ({}))) as {
    clientEmail?: string
    privateKey?: string | null
    calendarId?: string
    jsonKey?: Record<string, unknown>
  }

  let clientEmail = (body.clientEmail ?? '').trim()
  let privateKey = typeof body.privateKey === 'string' ? body.privateKey : null
  const calendarId = (body.calendarId ?? '').trim()

  if (body.jsonKey && typeof body.jsonKey === 'object') {
    const k = body.jsonKey as { client_email?: unknown; private_key?: unknown }
    if (typeof k.client_email === 'string') clientEmail = k.client_email
    if (typeof k.private_key === 'string') privateKey = k.private_key
  }

  if (!clientEmail || !/@/.test(clientEmail)) {
    return c.json(
      { error: 'clientEmail (service account email) is required', code: 'INVALID_CLIENT_EMAIL' },
      400
    )
  }
  if (!calendarId) {
    return c.json(
      { error: 'calendarId (shared clinic calendar) is required', code: 'INVALID_CALENDAR_ID' },
      400
    )
  }

  // Sanity-check the PEM only when provided (omitted = keep existing).
  if (privateKey && !privateKey.includes('PRIVATE KEY')) {
    return c.json(
      { error: 'privateKey does not look like a PEM block', code: 'INVALID_PRIVATE_KEY' },
      400
    )
  }

  try {
    const db = getDb(env.DATABASE_URL)
    c.set('skipAudit', true)
    await saveServiceAccountConfig(
      db,
      { clientEmail, privateKey: privateKey ?? null, calendarId },
      user.id
    )
    invalidateTokenCache()
    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'integrations',
      entityId: 'google_service_account_config',
      entityName: 'Google service account config',
      changes: { clientEmail, calendarId, privateKeyRotated: privateKey !== null },
    })
    const status = await getServiceAccountStatus(db)
    return c.json({ success: true, data: status })
  } catch (error) {
    logError(error, { route: 'google-calendar.sa-config.put', userId: user.id })
    return c.json({ error: 'Failed to save config', code: 'SA_CONFIG_SAVE_FAILED' }, 500)
  }
})

googleCalendarApp.delete('/service-account-config', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  try {
    const db = getDb(env.DATABASE_URL)
    c.set('skipAudit', true)
    await clearServiceAccountConfig(db)
    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: 'integrations',
      entityId: 'google_service_account_config',
      entityName: 'Google service account config cleared',
    })
    return c.json({ success: true })
  } catch (error) {
    logError(error, { route: 'google-calendar.sa-config.delete', userId: user.id })
    return c.json({ error: 'Failed to clear config', code: 'SA_CONFIG_CLEAR_FAILED' }, 500)
  }
})

// POST /service-account-config/test — mints a token to verify the credentials
// are valid and the SA can reach the configured calendar.
googleCalendarApp.post('/service-account-config/test', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  try {
    const db = getDb(env.DATABASE_URL)
    const resolved = await resolveServiceAccountConfig(db)
    if (!resolved) {
      return c.json({ success: true, data: { ok: false, reason: 'not_configured' } })
    }
    // Force a fresh token mint so we know the key is valid right now.
    invalidateTokenCache()
    const { calendarId } = resolved
    const { accessToken } = await import('../lib/google-service-account').then((m) =>
      m.getServiceAccountAccessToken(db)
    )
    // Hit the calendar's metadata endpoint — confirms the SA has been added.
    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!calRes.ok) {
      const text = await calRes.text().catch(() => '')
      return c.json({
        success: true,
        data: {
          ok: false,
          reason: 'calendar_access_denied',
          detail: `${calRes.status}: ${text.slice(0, 200)}`,
        },
      })
    }
    return c.json({ success: true, data: { ok: true } })
  } catch (error: unknown) {
    logError(error, { route: 'google-calendar.sa-config.test', userId: user.id })
    return c.json({
      success: true,
      data: { ok: false, reason: 'exception', detail: 'Unknown' },
    })
  }
})

// DELETE /oauth-config — drop the DB row, falling back to env vars.
googleCalendarApp.delete('/oauth-config', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  try {
    const db = getDb(env.DATABASE_URL)
    c.set('skipAudit', true)
    await clearOAuthConfig(db)
    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: 'integrations',
      entityId: 'google_oauth_config',
      entityName: 'Google OAuth config cleared (env fallback)',
    })
    return c.json({ success: true })
  } catch (error) {
    logError(error, { route: 'google-calendar.oauth-config.delete', userId: user.id })
    return c.json({ error: 'Failed to clear config', code: 'OAUTH_CONFIG_CLEAR_FAILED' }, 500)
  }
})

// ── SA shared-calendar ACL ───────────────────────────────────────────────────
// Without Domain-Wide Delegation the SA can't invite event attendees, but it
// CAN grant a user read access to the calendar — same effect for "doctor sees
// their schedule in Google Calendar", different mechanism.

googleCalendarApp.get('/shares', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  try {
    const db = getDb(env.DATABASE_URL)
    const shares = await listCalendarShares(db)
    return c.json({ success: true, data: shares })
  } catch (error: unknown) {
    logError(error, { route: 'google-calendar.shares.list', userId: user.id })
    return c.json({ error: 'Failed to list shares', code: 'CALENDAR_SHARES_LIST_FAILED' }, 500)
  }
})

// Body: { emails: string[], role?: 'reader' | 'writer' | 'freeBusyReader' }
// Returns per-email result so a partial failure (e.g. one bad email) still
// reports which ones succeeded.
googleCalendarApp.post('/shares', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    emails?: string[]
    role?: 'reader' | 'writer' | 'freeBusyReader'
  }
  const emails = (body.emails ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)
  if (emails.length === 0) {
    return c.json({ error: 'emails[] is required', code: 'INVALID_EMAILS' }, 400)
  }
  const role = body.role === 'writer' || body.role === 'freeBusyReader' ? body.role : 'reader'

  try {
    const db = getDb(env.DATABASE_URL)
    const results = await Promise.all(
      emails.map(async (email) => {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return { email, ok: false, error: 'invalid email format' }
        }
        try {
          const share = await shareCalendarWith(db, email, role)
          return { email, ok: true, ruleId: share.ruleId, role: share.role }
        } catch (err: unknown) {
          const pgErr = err as { message?: string }
          return { email, ok: false, error: pgErr.message ?? 'Failed' }
        }
      })
    )
    return c.json({ success: true, data: results })
  } catch (error: unknown) {
    logError(error, { route: 'google-calendar.shares.create', userId: user.id })
    return c.json({ error: 'Failed to share', code: 'CALENDAR_SHARES_CREATE_FAILED' }, 500)
  }
})

googleCalendarApp.delete('/shares/:ruleId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const ruleId = c.req.param('ruleId')
  try {
    const db = getDb(env.DATABASE_URL)
    await revokeCalendarShare(db, ruleId)
    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { route: 'google-calendar.shares.delete', userId: user.id, ruleId })
    return c.json({ error: 'Failed to revoke', code: 'CALENDAR_SHARES_DELETE_FAILED' }, 500)
  }
})

export { googleCalendarApp }
