/**
 * Google Contacts ↔ CRM sync routes (§21.4) — per-user connect, callback,
 * status, disconnect, and a sync trigger.
 *
 * Flow (mirrors /api/google-calendar):
 *   1. Frontend "Connect" → GET  /api/google-contacts/connect (signed-in)
 *      → 302 to Google's consent screen with HMAC-signed state.
 *   2. Google → GET  /api/google-contacts/callback?code=...&state=...
 *      → exchanges code, stores tokens (refresh token encrypted at rest),
 *        302 back to the CRM sync page.
 *   3. Frontend re-fetches GET /api/google-contacts/status.
 *   4. Frontend "Sync" → POST /api/google-contacts/sync — push patients →
 *      Google (the import direction is planned by the same service and exposed
 *      via POST /sync/import).
 *   5. Frontend "Disconnect" → DELETE /api/google-contacts — revokes the
 *      refresh token + drops the stored token row.
 *
 * OAuth credentials are SHARED with the Google Calendar integration
 * (`resolveOAuthConfig`) — one Google Cloud project. The People API `contacts`
 * scope must be added to that OAuth consent screen for this to work at runtime.
 *
 * Permissions: an authenticated session is enough to connect/disconnect YOUR
 * OWN Google account (same as google-calendar). The sync trigger is gated on
 * `patients:update` — the CRM surface has no dedicated permission module and
 * the sync mutates patient-derived contact data.
 */

import { Hono } from 'hono'
import { env } from '../config/env'
import { getDb } from '../db'
import { signState, verifyState } from '../lib/google-calendar'
import {
  buildContactsAuthUrl,
  deleteStoredToken,
  exchangeCodeForTokens,
  fetchUserInfo,
  getContactsConnection,
  pushPatientsToGoogle,
  revokeRefreshToken,
  saveConnection,
} from '../lib/google-contacts-service'
import { resolveOAuthConfig } from '../lib/google-oauth-config'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
// Reuse the Calendar lib's HMAC state signing — same scheme, same secret.
import { portalLink } from '../lib/public-urls'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const googleContactsApp = new Hono<HonoEnv>()

/** Where to send the user after callback — the CRM sync surface (§21.4) of the clinic portal. */
function getCrmSyncReturnUrl(): string {
  return portalLink('/crm/sync')
}

// ── GET /status ───────────────────────────────────────────────────────────────
// Whether the *current user* has connected Google Contacts.
googleContactsApp.get('/status', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(env.DATABASE_URL)
  const config = await resolveOAuthConfig(db)
  if (!config) {
    return c.json({
      success: true,
      data: { configured: false, connected: false, email: null, connectedAt: null },
    })
  }

  const conn = await getContactsConnection(db, user.id)
  return c.json({
    success: true,
    data: {
      configured: true,
      connected: !!conn,
      email: conn?.connectedEmail ?? null,
      connectedAt: conn?.connectedAt ?? null,
    },
  })
})

// ── GET /connect ──────────────────────────────────────────────────────────────
// Redirect the user to Google's consent screen with HMAC-signed state.
googleContactsApp.get('/connect', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(env.DATABASE_URL)
  const config = await resolveOAuthConfig(db)
  if (!config) {
    return c.json(
      {
        error:
          'Google OAuth is not configured. Ask an admin to configure it in Integrations → Google Calendar (the same credentials power Contacts).',
      },
      409
    )
  }

  const state = signState(user.id)
  return c.redirect(buildContactsAuthUrl(config, state))
})

// ── GET /callback ─────────────────────────────────────────────────────────────
// Google → us. Exchanges the auth code for tokens and persists them.
googleContactsApp.get('/callback', async (c) => {
  const db = getDb(env.DATABASE_URL)
  const config = await resolveOAuthConfig(db)
  if (!config) {
    return c.redirect(`${getCrmSyncReturnUrl()}?error=not_configured`)
  }

  const googleError = c.req.query('error')
  if (googleError) {
    return c.redirect(`${getCrmSyncReturnUrl()}?error=${encodeURIComponent(googleError)}`)
  }

  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) {
    return c.redirect(`${getCrmSyncReturnUrl()}?error=missing_code_or_state`)
  }

  const verified = verifyState(state)
  if (!verified.ok) {
    return c.redirect(`${getCrmSyncReturnUrl()}?error=${encodeURIComponent(verified.reason)}`)
  }

  try {
    const tokens = await exchangeCodeForTokens(config, code)
    if (!tokens.refresh_token) {
      return c.redirect(`${getCrmSyncReturnUrl()}?error=no_refresh_token`)
    }
    const { email } = await fetchUserInfo(tokens.access_token)
    await saveConnection(db, verified.userId, tokens, email)
    return c.redirect(`${getCrmSyncReturnUrl()}?connected=1`)
  } catch (err) {
    logError(err, { context: '[google-contacts/callback] failed' })
    return c.redirect(`${getCrmSyncReturnUrl()}?error=token_exchange_failed`)
  }
})

// ── DELETE / ──────────────────────────────────────────────────────────────────
// Disconnect the current user. Revokes the refresh token on Google's side too.
googleContactsApp.delete('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(env.DATABASE_URL)
  const refreshToken = await deleteStoredToken(db, user.id)
  if (refreshToken) await revokeRefreshToken(refreshToken)

  return c.json({ success: true, data: { disconnected: true } })
})

// ── POST /sync ────────────────────────────────────────────────────────────────
// Push CRM patients → the connected user's Google Contacts. The CRM surface
// gates on the `patients` module (there is no dedicated CRM permission); this
// mutates patient-derived contact data, so require patients:update.
googleContactsApp.post('/sync', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const allowed = await checkPermission(
    c,
    user.id,
    MODULES.PATIENTS as string,
    ACTIONS.UPDATE as string
  )
  if (!allowed) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const db = getDb(env.DATABASE_URL)
  const conn = await getContactsConnection(db, user.id)
  if (!conn) {
    return c.json({ error: 'Google Contacts not connected', code: 'NOT_CONNECTED' }, 409)
  }

  try {
    const result = await pushPatientsToGoogle(db, user.id)
    return c.json({ success: true, data: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed'
    logError(err, { context: '[google-contacts/sync] failed', userId: user.id })
    return c.json({ error: msg, code: 'SYNC_FAILED' }, 500)
  }
})

export { googleContactsApp }
