// Service-account auth for Google Calendar — writes to a single shared
// "clinic" calendar instead of per-doctor calendars. Sits alongside the
// OAuth flow; an admin toggles which one is active in Integrations.
//
// Why this layout:
//  - No googleapis dep — we mint the JWT ourselves with node:crypto, exchange
//    it for an access token via the same fetch path as the OAuth refresh code.
//  - Private key encrypted at rest with AES-256-GCM (same key derivation as
//    the OAuth secret store — keep one trust anchor, BETTER_AUTH_SECRET).
//  - In-memory access-token cache so we don't mint a fresh JWT per appointment.

import { createCipheriv, createDecipheriv, createHash, createSign, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { env } from '../config/env'
import type { getDb } from '../db'
import { clinicSettings } from '../db/schema'
import { logger } from './logger'

export const SERVICE_ACCOUNT_CONFIG_KEY = 'integrations:google_service_account_config'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/calendar'

type Db = ReturnType<typeof getDb>

type EncryptedBlob = { iv: string; ct: string; tag: string }

type StoredSAConfig = {
  /** Service account email, e.g. svc-name@project.iam.gserviceaccount.com */
  clientEmail: string
  /** PEM-encoded private key, AES-256-GCM encrypted. */
  encryptedPrivateKey: EncryptedBlob | null
  /** The shared calendar this SA writes events to (e.g. an @group.calendar.google.com id). */
  calendarId: string
}

export type ServiceAccountStatus = {
  source: 'db' | 'none'
  clientEmail: string | null
  calendarId: string | null
  hasPrivateKey: boolean
}

function getEncryptionKey(): Buffer {
  return createHash('sha256').update(env.BETTER_AUTH_SECRET, 'utf8').digest()
}

function encrypt(plaintext: string): EncryptedBlob {
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return { iv: iv.toString('hex'), ct: ct.toString('hex'), tag: tag.toString('hex') }
}

function decrypt(blob: EncryptedBlob): string | null {
  try {
    const key = getEncryptionKey()
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'))
    decipher.setAuthTag(Buffer.from(blob.tag, 'hex'))
    const pt = Buffer.concat([decipher.update(Buffer.from(blob.ct, 'hex')), decipher.final()])
    return pt.toString('utf8')
  } catch {
    return null
  }
}

async function readStored(db: Db): Promise<StoredSAConfig | null> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, SERVICE_ACCOUNT_CONFIG_KEY))
    .limit(1)
  if (!row) return null
  const v = row.value as Partial<StoredSAConfig> | null
  if (!v || typeof v.clientEmail !== 'string' || typeof v.calendarId !== 'string') return null
  return {
    clientEmail: v.clientEmail,
    calendarId: v.calendarId,
    encryptedPrivateKey: v.encryptedPrivateKey ?? null,
  }
}

export async function getServiceAccountStatus(db: Db): Promise<ServiceAccountStatus> {
  const stored = await readStored(db)
  if (!stored) {
    return { source: 'none', clientEmail: null, calendarId: null, hasPrivateKey: false }
  }
  return {
    source: 'db',
    clientEmail: stored.clientEmail,
    calendarId: stored.calendarId,
    hasPrivateKey: stored.encryptedPrivateKey !== null,
  }
}

/**
 * Returns the resolved (decrypted) SA config, or null if unusable.
 * Used by the token minter; never serialise the return value.
 */
export async function resolveServiceAccountConfig(db: Db): Promise<{
  clientEmail: string
  privateKey: string
  calendarId: string
} | null> {
  const stored = await readStored(db)
  if (!stored?.encryptedPrivateKey) return null
  const privateKey = decrypt(stored.encryptedPrivateKey)
  if (!privateKey) return null
  return {
    clientEmail: stored.clientEmail,
    privateKey,
    calendarId: stored.calendarId,
  }
}

/**
 * Save SA config. Accepts either a parsed JSON-key payload OR explicit fields.
 * If `privateKey` is empty/omitted the existing encrypted blob is preserved.
 */
export async function saveServiceAccountConfig(
  db: Db,
  input: { clientEmail: string; privateKey: string | null; calendarId: string },
  updatedById: string
): Promise<void> {
  const existing = await readStored(db)
  const encryptedPrivateKey =
    input.privateKey && input.privateKey.length > 0
      ? encrypt(input.privateKey)
      : (existing?.encryptedPrivateKey ?? null)

  const value: StoredSAConfig = {
    clientEmail: input.clientEmail,
    calendarId: input.calendarId,
    encryptedPrivateKey,
  }

  await db
    .insert(clinicSettings)
    .values({ key: SERVICE_ACCOUNT_CONFIG_KEY, value, updatedById })
    .onConflictDoUpdate({
      target: clinicSettings.key,
      set: { value, updatedById, updatedAt: new Date() },
    })
}

export async function clearServiceAccountConfig(db: Db): Promise<void> {
  await db.delete(clinicSettings).where(eq(clinicSettings.key, SERVICE_ACCOUNT_CONFIG_KEY))
  invalidateTokenCache()
}

// ── JWT signing + access-token exchange ──────────────────────────────────────

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8')
  return b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function buildAssertion(clientEmail: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()
  const signature = signer.sign(privateKeyPem)
  return `${signingInput}.${b64url(signature)}`
}

// Token cache. Service-account tokens last 1 hour; we cache until 60s before
// expiry to avoid edge-case 401s mid-request. Single-process cache — fine for
// the current DO App Platform single-instance deployment.
type CachedToken = { token: string; expiresAt: number }
let cachedToken: CachedToken | null = null

export function invalidateTokenCache() {
  cachedToken = null
}

// ── Calendar sharing (ACL) ───────────────────────────────────────────────────
// Without Domain-Wide Delegation we can't auto-invite attendees, but the SA
// CAN grant ACL access to its own shared calendar. Doctors get an email from
// Google saying "Calendar X has been shared with you" — once they click
// "Add", events appear in their Google Calendar list alongside their own.

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3'

export type CalendarShareRole = 'reader' | 'writer' | 'freeBusyReader'

export type CalendarShare = {
  /** ACL rule id, e.g. "user:foo@bar.com". Stable identifier for revoke. */
  ruleId: string
  email: string
  role: CalendarShareRole
}

async function calendarFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${CALENDAR_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

/** List user-scoped ACL entries on the configured shared calendar. Filters
 *  out the SA's own owner entry + non-user scopes (e.g. domain, default). */
export async function listCalendarShares(db: Db): Promise<CalendarShare[]> {
  const { accessToken, calendarId } = await getServiceAccountAccessToken(db)
  const res = await calendarFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/acl`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`listCalendarShares failed (${res.status}): ${text}`)
  }
  const json = (await res.json()) as {
    items?: Array<{ id: string; role: string; scope?: { type?: string; value?: string } }>
  }
  return (json.items ?? [])
    .filter((item) => item.scope?.type === 'user' && item.role !== 'owner')
    .map((item) => ({
      ruleId: item.id,
      email: item.scope?.value ?? '',
      role: (item.role as CalendarShareRole) ?? 'reader',
    }))
}

/** Grant a user access to the shared calendar. `sendNotifications` triggers
 *  Google's "shared with you" invite email so the doctor can click + add. */
export async function shareCalendarWith(
  db: Db,
  email: string,
  role: CalendarShareRole = 'reader'
): Promise<CalendarShare> {
  const { accessToken, calendarId } = await getServiceAccountAccessToken(db)
  const res = await calendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/acl?sendNotifications=true`,
    {
      method: 'POST',
      body: JSON.stringify({ role, scope: { type: 'user', value: email } }),
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`shareCalendarWith failed (${res.status}): ${text}`)
  }
  const json = (await res.json()) as { id?: string; role?: string }
  return {
    ruleId: json.id ?? `user:${email}`,
    email,
    role: (json.role as CalendarShareRole) ?? role,
  }
}

/** Revoke a previously-granted share. ruleId comes from listCalendarShares. */
export async function revokeCalendarShare(db: Db, ruleId: string): Promise<void> {
  const { accessToken, calendarId } = await getServiceAccountAccessToken(db)
  const res = await calendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/acl/${encodeURIComponent(ruleId)}`,
    { method: 'DELETE' }
  )
  // 404 / 410 = already gone — treat as success.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text().catch(() => '')
    throw new Error(`revokeCalendarShare failed (${res.status}): ${text}`)
  }
}

// ── Per-doctor calendars ─────────────────────────────────────────────────────
// Each internal specialist gets their own Google calendar so they only see
// their own appointments. The shared "clinic calendar" configured in SA setup
// is kept as a fallback / admin overview.

type SpecialistRow = {
  id: string
  name: string
  gcalCalendarId: string | null
  user?: { email: string | null } | null
  contactEmail: string | null
}

/** Resolve (or create) the dedicated Google calendar for a specialist.
 *  Returns the calendarId. On first call, creates a new calendar via the
 *  SA, shares it with the doctor's email if available, and persists the
 *  resulting calendarId on the specialist row.
 *
 *  Caller is responsible for the DB update — we return the new id so the
 *  caller can persist it in whatever way fits its tx. (Avoids this lib
 *  pulling in the specialists schema directly + circular-import risk.) */
export async function ensureDoctorCalendar(
  db: Db,
  specialist: SpecialistRow,
  persist: (specialistId: string, calendarId: string) => Promise<void>
): Promise<string> {
  if (specialist.gcalCalendarId) return specialist.gcalCalendarId

  const { accessToken } = await getServiceAccountAccessToken(db)

  // 1. Create a new calendar owned by the SA.
  const summary = specialist.name.toLowerCase().startsWith('dr')
    ? `${specialist.name} — Denel`
    : `Dr. ${specialist.name} — Denel`
  const createRes = await fetch(`${CALENDAR_BASE}/calendars`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ summary }),
  })
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '')
    throw new Error(`createCalendar failed (${createRes.status}): ${text}`)
  }
  const created = (await createRes.json()) as { id?: string }
  if (!created.id) throw new Error('createCalendar: missing id in response')
  const calendarId = created.id

  // 2. Best-effort share with the doctor's email. If Google rejects (e.g.
  // bad email or no permission), keep the calendar — admin can share it
  // manually later via the Integrations card.
  const doctorEmail = specialist.user?.email ?? specialist.contactEmail ?? null
  if (doctorEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(doctorEmail)) {
    try {
      const aclRes = await fetch(
        `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/acl?sendNotifications=true`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ role: 'reader', scope: { type: 'user', value: doctorEmail } }),
        }
      )
      if (!aclRes.ok) {
        const text = await aclRes.text().catch(() => '')
        logger.warn(
          `[ensureDoctorCalendar] share ${calendarId} → ${doctorEmail} failed (${aclRes.status}): ${text}`
        )
      }
    } catch (err) {
      logger.warn({ err }, `[ensureDoctorCalendar] share ${calendarId} → ${doctorEmail} threw`)
    }
  }

  // 3. Persist via the caller-supplied callback.
  await persist(specialist.id, calendarId)
  return calendarId
}

export async function getServiceAccountAccessToken(db: Db): Promise<{
  accessToken: string
  calendarId: string
}> {
  const now = Date.now()
  const config = await resolveServiceAccountConfig(db)
  if (!config) throw new Error('Service account not configured')

  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return { accessToken: cachedToken.token, calendarId: config.calendarId }
  }

  const assertion = buildAssertion(config.clientEmail, config.privateKey)
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  })
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`SA token exchange failed (${res.status}): ${text}`)
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    token: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  }
  return { accessToken: json.access_token, calendarId: config.calendarId }
}
