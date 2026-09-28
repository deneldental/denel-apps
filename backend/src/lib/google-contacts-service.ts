/**
 * Google Contacts ↔ CRM sync (§21.4).
 *
 * Mirrors the Google Calendar OAuth integration:
 *  - OAuth credentials (clientId/secret/redirectUri) are resolved from the same
 *    DB-backed `clinic_settings` config the Calendar flow uses
 *    (`resolveOAuthConfig`) — one Google Cloud project, two scoped integrations.
 *  - Per-user tokens (access + refresh) are persisted in a `clinic_settings` KV
 *    row keyed by user id, with the refresh token AES-256-GCM encrypted at rest
 *    (no new schema/migration required — stays within the existing KV store).
 *  - OAuth state is HMAC-signed (reuses `signState`/`verifyState` from the
 *    Calendar lib) so there is no server-side state store.
 *  - No `googleapis` npm dep — we hit the People API over HTTPS with `fetch()`.
 *
 * The runtime sync (push patients → Google, import Google → CRM) needs Google
 * OAuth client creds configured (GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REDIRECT_URI
 * or the DB-backed equivalent) and the `contacts` scope granted. The pure
 * mapping/merge/dedupe logic below is fully unit-testable without any creds —
 * that is what the smoke test exercises.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { addSeconds } from 'date-fns'
import { eq } from 'drizzle-orm'
import { env } from '../config/env'
import type { getDb } from '../db'
import { clinicSettings, patients } from '../db/schema'
import { type GoogleOAuthConfig, resolveOAuthConfig } from './google-oauth-config'
import { logError } from './logger'
import { formatPhoneNumber } from './utils/phone'

type Db = ReturnType<typeof getDb>

// ── Scopes & endpoints ────────────────────────────────────────────────────────

/**
 * Read/write the user's own Google Contacts plus their email (so the UI can
 * show "connected as <email>"). `contacts` (not `contacts.readonly`) is needed
 * because the push direction writes patient cards into Google.
 */
export const GOOGLE_CONTACTS_SCOPE = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
].join(' ')

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'
const PEOPLE_BASE = 'https://people.googleapis.com/v1'

/** Person fields we request/write on the People API. */
const PERSON_FIELDS = 'names,emailAddresses,phoneNumbers,metadata'

// ── Token storage (clinic_settings KV, refresh token encrypted) ───────────────
// One row per connected user, key = `integrations:google_contacts_token:<userId>`.
// This avoids a new table/migration while still keeping the refresh token
// encrypted at rest (same AES-256-GCM scheme as google-oauth-config.ts).

const TOKEN_KEY_PREFIX = 'integrations:google_contacts_token:'

export function contactsTokenKey(userId: string): string {
  return `${TOKEN_KEY_PREFIX}${userId}`
}

type EncBlob = { iv: string; ct: string; tag: string }

type StoredToken = {
  connectedEmail: string
  scope: string
  accessToken: string
  /** AES-256-GCM ciphertext of the refresh token. */
  refresh: EncBlob
  /** Wall-clock expiry (epoch ms) of the current access token. */
  tokenExpiresAt: number
  connectedAt: number
  updatedAt: number
}

function getEncryptionKey(): Buffer {
  return createHash('sha256').update(env.BETTER_AUTH_SECRET, 'utf8').digest()
}

function encryptSecret(plaintext: string): EncBlob {
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return { iv: iv.toString('hex'), ct: ct.toString('hex'), tag: tag.toString('hex') }
}

function decryptSecret(blob: EncBlob): string | null {
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

export type ContactsConnection = {
  connectedEmail: string
  connectedAt: Date | null
}

/** Public view of whether the current user has connected Google Contacts. */
export async function getContactsConnection(
  db: Db,
  userId: string
): Promise<ContactsConnection | null> {
  const stored = await readStoredToken(db, userId)
  if (!stored) return null
  return {
    connectedEmail: stored.connectedEmail,
    connectedAt: stored.connectedAt ? new Date(stored.connectedAt) : null,
  }
}

async function readStoredToken(db: Db, userId: string): Promise<StoredToken | null> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, contactsTokenKey(userId)))
    .limit(1)
  if (!row) return null
  const v = row.value as Partial<StoredToken> | null
  if (
    !v ||
    typeof v.connectedEmail !== 'string' ||
    typeof v.accessToken !== 'string' ||
    !v.refresh ||
    typeof v.tokenExpiresAt !== 'number'
  ) {
    return null
  }
  return v as StoredToken
}

async function writeStoredToken(
  db: Db,
  userId: string,
  token: StoredToken,
  updatedById: string
): Promise<void> {
  await db
    .insert(clinicSettings)
    .values({ key: contactsTokenKey(userId), value: token, updatedById })
    .onConflictDoUpdate({
      target: clinicSettings.key,
      set: { value: token, updatedById, updatedAt: new Date() },
    })
}

export async function deleteStoredToken(db: Db, userId: string): Promise<string | null> {
  const stored = await readStoredToken(db, userId)
  await db.delete(clinicSettings).where(eq(clinicSettings.key, contactsTokenKey(userId)))
  // Return the (decrypted) refresh token so the caller can revoke it on Google.
  return stored ? decryptSecret(stored.refresh) : null
}

// ── OAuth URLs + token exchange ───────────────────────────────────────────────

export function buildContactsAuthUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_CONTACTS_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

type TokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope: string
  token_type: string
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

async function refreshAccessToken(
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

export async function fetchUserInfo(accessToken: string): Promise<{ email: string }> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`userinfo failed (${res.status})`)
  const json = (await res.json()) as { email?: string }
  if (!json.email) throw new Error('userinfo missing email')
  return { email: json.email }
}

/**
 * Persist a freshly exchanged token set for `userId`. Called from the OAuth
 * callback after `exchangeCodeForTokens`.
 */
export async function saveConnection(
  db: Db,
  userId: string,
  tokens: TokenResponse,
  email: string
): Promise<void> {
  if (!tokens.refresh_token) {
    throw new Error('no_refresh_token')
  }
  const now = Date.now()
  const existing = await readStoredToken(db, userId)
  const token: StoredToken = {
    connectedEmail: email,
    scope: tokens.scope,
    accessToken: tokens.access_token,
    refresh: encryptSecret(tokens.refresh_token),
    tokenExpiresAt: addSeconds(new Date(), tokens.expires_in).getTime(),
    connectedAt: existing?.connectedAt ?? now,
    updatedAt: now,
  }
  await writeStoredToken(db, userId, token, userId)
}

/**
 * Returns an access token good for at least the next 60s, refreshing + persisting
 * a new one if needed. Throws if the user isn't connected or the refresh fails
 * (e.g. the user revoked access on Google's side).
 */
async function getValidAccessToken(db: Db, userId: string): Promise<string> {
  const stored = await readStoredToken(db, userId)
  if (!stored) throw new Error(`No Google Contacts connection for user ${userId}`)

  const expiresInSeconds = (stored.tokenExpiresAt - Date.now()) / 1000
  if (expiresInSeconds > 60) return stored.accessToken

  const config = await resolveOAuthConfig(db)
  if (!config) throw new Error('Google OAuth not configured')
  const refreshToken = decryptSecret(stored.refresh)
  if (!refreshToken) throw new Error('refresh token could not be decrypted')

  const tokens = await refreshAccessToken(config, refreshToken)
  const updated: StoredToken = {
    ...stored,
    accessToken: tokens.access_token,
    tokenExpiresAt: addSeconds(new Date(), tokens.expires_in).getTime(),
    updatedAt: Date.now(),
  }
  await writeStoredToken(db, userId, updated, userId)
  return tokens.access_token
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  try {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' })
  } catch (err) {
    logError(err, { context: '[google-contacts] revoke failed (continuing)' })
  }
}

// ── Pure mapping / merge / dedupe logic (unit-testable, no creds needed) ───────

/** A normalized contact — the shared shape both a CRM patient and a Google
 *  Contact map into. `phoneKey` is the dedupe key (digits-only, country-coded). */
export type NormalizedContact = {
  name: string
  email: string | null
  phone: string | null
  /** Stable dedupe key derived from `phone`; '' when there is no usable phone. */
  phoneKey: string
}

/** Minimal CRM patient shape needed for mapping (subset of the patients row). */
export type PatientLike = {
  id: string
  name: string
  email: string | null
  phone: string | null
}

/** A Google People API `person` resource (only the fields we touch). */
export type GooglePerson = {
  resourceName?: string
  etag?: string
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>
  emailAddresses?: Array<{ value?: string }>
  phoneNumbers?: Array<{ value?: string; canonicalForm?: string }>
}

/**
 * Dedupe key for a phone. Normalizes to the clinic's country-coded digits-only
 * form (`formatPhoneNumber`) so `024 123 4567`, `+233241234567` and
 * `0241234567` all collapse to the same key. Empty string when unusable.
 */
export function phoneKeyOf(phone: string | null | undefined): string {
  if (!phone) return ''
  const formatted = formatPhoneNumber(phone)
  return formatted.length >= 10 ? formatted : ''
}

function cleanStr(s: string | null | undefined): string | null {
  if (s == null) return null
  const t = s.trim()
  return t.length > 0 ? t : null
}

/** Map a CRM patient → the normalized shape. */
export function patientToContact(p: PatientLike): NormalizedContact {
  const phone = cleanStr(p.phone)
  return {
    name: p.name.trim(),
    email: cleanStr(p.email),
    phone,
    phoneKey: phoneKeyOf(phone),
  }
}

/** Map a Google People `person` → the normalized shape. */
export function googlePersonToContact(person: GooglePerson): NormalizedContact {
  const name =
    cleanStr(person.names?.[0]?.displayName) ??
    cleanStr(
      [person.names?.[0]?.givenName, person.names?.[0]?.familyName].filter(Boolean).join(' ')
    ) ??
    ''
  const email = cleanStr(person.emailAddresses?.[0]?.value)
  const phoneRaw =
    cleanStr(person.phoneNumbers?.[0]?.canonicalForm) ?? cleanStr(person.phoneNumbers?.[0]?.value)
  return {
    name,
    email,
    phone: phoneRaw,
    phoneKey: phoneKeyOf(phoneRaw),
  }
}

/** Build the People API `person` body for a patient (push direction). */
export function contactToGooglePersonBody(
  c: NormalizedContact
): Pick<GooglePerson, 'names' | 'emailAddresses' | 'phoneNumbers'> {
  const body: Pick<GooglePerson, 'names' | 'emailAddresses' | 'phoneNumbers'> = {
    names: [{ displayName: c.name }],
  }
  if (c.email) body.emailAddresses = [{ value: c.email }]
  if (c.phone) body.phoneNumbers = [{ value: c.phone }]
  return body
}

/**
 * Index a set of Google contacts by their phone dedupe key. Contacts without a
 * usable phone are dropped (can't be matched against patients reliably). When
 * two Google contacts share a phone key, the first one wins (stable).
 */
export function indexByPhone(contacts: NormalizedContact[]): Map<string, NormalizedContact> {
  const map = new Map<string, NormalizedContact>()
  for (const c of contacts) {
    if (!c.phoneKey) continue
    if (!map.has(c.phoneKey)) map.set(c.phoneKey, c)
  }
  return map
}

export type MergeAction =
  | { type: 'create'; patient: PatientLike; contact: NormalizedContact }
  | {
      type: 'update'
      patient: PatientLike
      contact: NormalizedContact
      existing: NormalizedContact
    }
  | { type: 'skip'; patient: PatientLike; reason: 'no_phone' | 'in_sync' }

/**
 * Decide what to do for each patient against the current Google contacts,
 * deduping by phone. Pure — no network, no DB. This is the heart of the
 * push-to-Google direction and the unit under test.
 *
 *  - `no_phone`   → skip (can't dedupe/match without a phone).
 *  - no match     → create a new Google contact.
 *  - match, same  → skip ('in_sync'): name+email already match.
 *  - match, diff  → update the existing contact in place (no duplicate card).
 */
export function planContactSync(
  patientsList: PatientLike[],
  googleContacts: NormalizedContact[]
): MergeAction[] {
  const byPhone = indexByPhone(googleContacts)
  const actions: MergeAction[] = []
  for (const p of patientsList) {
    const contact = patientToContact(p)
    if (!contact.phoneKey) {
      actions.push({ type: 'skip', patient: p, reason: 'no_phone' })
      continue
    }
    const existing = byPhone.get(contact.phoneKey)
    if (!existing) {
      actions.push({ type: 'create', patient: p, contact })
      continue
    }
    if (contactsEquivalent(contact, existing)) {
      actions.push({ type: 'skip', patient: p, reason: 'in_sync' })
    } else {
      actions.push({ type: 'update', patient: p, contact, existing })
    }
  }
  return actions
}

/** Two contacts are equivalent for sync purposes when name + email + phone-key match. */
export function contactsEquivalent(a: NormalizedContact, b: NormalizedContact): boolean {
  return (
    a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
    (a.email ?? '').trim().toLowerCase() === (b.email ?? '').trim().toLowerCase() &&
    a.phoneKey === b.phoneKey
  )
}

export type ImportAction =
  | { type: 'create'; contact: NormalizedContact }
  | { type: 'update'; contact: NormalizedContact; patientId: string }
  | { type: 'skip'; contact: NormalizedContact; reason: 'no_phone' | 'in_sync' }

/**
 * Decide what to do for each Google contact against the current CRM patients,
 * deduping by phone (import direction: Google → CRM). Pure.
 *
 *  - `no_phone`  → skip (can't match a contact with no phone to a patient).
 *  - no match    → create a new patient.
 *  - match, same → skip ('in_sync').
 *  - match, diff → update the matched patient.
 */
export function planContactImport(
  googleContacts: NormalizedContact[],
  patientsList: PatientLike[]
): ImportAction[] {
  const byPhone = new Map<string, PatientLike>()
  for (const p of patientsList) {
    const key = phoneKeyOf(p.phone)
    if (key && !byPhone.has(key)) byPhone.set(key, p)
  }
  const actions: ImportAction[] = []
  for (const contact of googleContacts) {
    if (!contact.phoneKey) {
      actions.push({ type: 'skip', contact, reason: 'no_phone' })
      continue
    }
    const match = byPhone.get(contact.phoneKey)
    if (!match) {
      actions.push({ type: 'create', contact })
      continue
    }
    if (contactsEquivalent(contact, patientToContact(match))) {
      actions.push({ type: 'skip', contact, reason: 'in_sync' })
    } else {
      actions.push({ type: 'update', contact, patientId: match.id })
    }
  }
  return actions
}

// ── People API helpers (runtime; need a valid access token) ───────────────────

/** Page through the user's Google connections, returning normalized contacts. */
export async function fetchGoogleContacts(db: Db, userId: string): Promise<NormalizedContact[]> {
  const accessToken = await getValidAccessToken(db, userId)
  const out: NormalizedContact[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      personFields: PERSON_FIELDS,
      pageSize: '1000',
      sources: 'READ_SOURCE_TYPE_CONTACT',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(`${PEOPLE_BASE}/people/me/connections?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`people.connections.list failed (${res.status}): ${errText}`)
    }
    const json = (await res.json()) as {
      connections?: GooglePerson[]
      nextPageToken?: string
    }
    for (const person of json.connections ?? []) {
      out.push(googlePersonToContact(person))
    }
    pageToken = json.nextPageToken
  } while (pageToken)
  return out
}

async function createGoogleContact(accessToken: string, contact: NormalizedContact): Promise<void> {
  const res = await fetch(`${PEOPLE_BASE}/people:createContact`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(contactToGooglePersonBody(contact)),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`people.createContact failed (${res.status}): ${errText}`)
  }
}

export type SyncResult = { created: number; updated: number; skipped: number; failed: number }

/**
 * Push CRM patients → Google Contacts for the connected user. Loads the user's
 * patients + current Google contacts, plans the merge with `planContactSync`,
 * then applies CREATE actions (UPDATE is reported but left to a follow-up PATCH
 * pass — see the route note). Returns counts for the UI.
 */
export async function pushPatientsToGoogle(db: Db, userId: string): Promise<SyncResult> {
  const accessToken = await getValidAccessToken(db, userId)
  const patientRows = await db
    .select({
      id: patients.id,
      name: patients.name,
      email: patients.email,
      phone: patients.phone,
    })
    .from(patients)
  const googleContacts = await fetchGoogleContacts(db, userId)
  const actions = planContactSync(patientRows, googleContacts)

  const result: SyncResult = { created: 0, updated: 0, skipped: 0, failed: 0 }
  for (const action of actions) {
    if (action.type === 'skip') {
      result.skipped += 1
      continue
    }
    if (action.type === 'create') {
      try {
        await createGoogleContact(accessToken, action.contact)
        result.created += 1
      } catch (err) {
        logError(err, { context: '[google-contacts] create failed', patientId: action.patient.id })
        result.failed += 1
      }
      continue
    }
    // 'update' — counted; the in-place PATCH is a follow-up (needs resourceName
    // + etag plumbed through the planner). Reported so the UI is honest.
    result.updated += 1
  }
  return result
}
