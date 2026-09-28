import { and, eq, gt } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { env, isDevEnvironment } from '../config/env'
import { getDb } from '../db'
import { consentFormTemplates, patientSessions, patients, signedConsentForms } from '../db/schema'
import { requestOtpByPhone, verifyOtpByPhone } from '../lib/patient-otp'
import { patientIsOrtho } from '../lib/patient-tags-query'
import {
  clearCurrentDeviceTrust,
  getTrustedPhone,
  isTrustedDeviceForPhone,
  trustDeviceForPhone,
} from '../lib/patient-trusted-device'
import type { HonoEnv } from '../lib/types'
import { formatPhoneNumber, isValidPhoneNumber } from '../lib/utils/phone'

const patientAuthApp = new Hono<HonoEnv>()

// ─── IP rate limiter ─────────────────────────────────────────────────────────
// 30 requests per 5 minutes per IP across all /api/patient-auth/* routes.
// Protects the OTP send + login endpoints from brute force.
const _ipStore = new Map<string, { count: number; resetAt: number }>()
const IP_LIMIT = 30
const IP_WINDOW_MS = 5 * 60 * 1000
const IP_STORE_MAX = 5000

patientAuthApp.use('*', async (c, next) => {
  if (isDevEnvironment()) return next()

  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? ''
  if (!ip) return next()

  const now = Date.now()
  const entry = _ipStore.get(ip)

  if (!entry || now > entry.resetAt) {
    if (!entry && _ipStore.size >= IP_STORE_MAX) {
      // Prune one expired entry to cap memory
      for (const [k, v] of _ipStore) {
        if (now > v.resetAt) {
          _ipStore.delete(k)
          break
        }
      }
    }
    _ipStore.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS })
  } else {
    entry.count++
    if (entry.count > IP_LIMIT) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      return c.json({ error: 'Too many requests. Please try again later.' }, 429, {
        'Retry-After': String(retryAfter),
      })
    }
  }

  return next()
})

const SESSION_COOKIE = 'patient_session'
const SESSION_TTL_DAYS = 30
const cookieAttrs = () =>
  isDevEnvironment() ? 'Path=/; HttpOnly; SameSite=Lax' : 'Path=/; HttpOnly; Secure; SameSite=None'

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sha256Hex(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function generateToken(): Promise<{ raw: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const raw = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const hash = await sha256Hex(raw)
  return { raw, hash }
}

function sessionCookieHeader(rawToken: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${rawToken}; ${cookieAttrs()}; Max-Age=${maxAgeSeconds}`
}

// §2.7: `isOrtho` is derived from the 'Ortho' patient tag rather than a legacy
// column. We keep the `isOrtho` boolean in the response so the patient app keeps
// working unchanged; this makes the payload builder async (one EXISTS query).
async function patientPayload(db: ReturnType<typeof getDb>, p: typeof patients.$inferSelect) {
  return {
    id: p.id,
    patientId: p.patientId,
    name: p.name,
    email: p.email,
    phone: p.phone,
    dob: p.dob,
    gender: p.gender,
    category: p.category,
    isChild: p.isChild,
    isOrtho: await patientIsOrtho(db, p.id),
    profileImage: p.profileImage,
  }
}

function getClientIp(c: Context<HonoEnv>): string | null {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null
}

// Resolve every enabled patient reachable from a normalized phone — matches the
// patient's own phone OR a child's guardianPhone (the family profile group).
// Only `pwaAccessEnabled` patients appear: this is the portal enablement gate,
// re-evaluated on every call so enable/disable takes effect immediately.
async function findEnabledPatientsByPhone(
  db: ReturnType<typeof getDb>,
  normalizedPhone: string
): Promise<(typeof patients.$inferSelect)[]> {
  const enabled = await db.select().from(patients).where(eq(patients.pwaAccessEnabled, true))
  return enabled.filter(
    (p) =>
      formatPhoneNumber(p.phone) === normalizedPhone ||
      formatPhoneNumber(p.guardianPhone) === normalizedPhone
  )
}

// ─── Patient App Access consent (Phase 3) ───────────────────────────────────
// Gate 2 of the two-gate model: before a patient's records load, the patient
// (or their guardian) must have a signed "Patient App Access" consent on file.
// The template is data, lazily ensured here so the gate is self-bootstrapping.

const APP_CONSENT_NAME = 'Patient App Access'
const APP_CONSENT_CONTENT = `# Patient App Access — Consent

By signing below, I consent to accessing my personal and medical records held by
Denel Dental Clinic through the Denel patient app, and to receiving related
notifications.

I understand that:

- This phone number and device may be used to view my records and those of family
  members I am authorised for.
- I am responsible for keeping my device secure. If I lose access to this phone, I
  should contact the clinic so access can be reset.
- I may withdraw this consent at any time by contacting the clinic, after which app
  access will be disabled.

Where the patient is a minor, this consent is given by the parent or legal guardian
on the patient's behalf.`

async function ensureAppConsentTemplate(
  db: ReturnType<typeof getDb>
): Promise<typeof consentFormTemplates.$inferSelect> {
  const [existing] = await db
    .select()
    .from(consentFormTemplates)
    .where(eq(consentFormTemplates.name, APP_CONSENT_NAME))
    .limit(1)
  if (existing) return existing

  const [created] = await db
    .insert(consentFormTemplates)
    .values({
      name: APP_CONSENT_NAME,
      category: 'app_access',
      content: APP_CONSENT_CONTENT,
      requiresSignature: true,
      requiresWitness: false,
      active: true,
    })
    .onConflictDoNothing()
    .returning()
  if (created) return created

  // Lost an insert race — re-select the row the other writer created.
  const [row] = await db
    .select()
    .from(consentFormTemplates)
    .where(eq(consentFormTemplates.name, APP_CONSENT_NAME))
    .limit(1)
  return row
}

async function hasSignedAppConsent(
  db: ReturnType<typeof getDb>,
  patientId: string,
  templateId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: signedConsentForms.id })
    .from(signedConsentForms)
    .where(
      and(
        eq(signedConsentForms.patientId, patientId),
        eq(signedConsentForms.templateId, templateId)
      )
    )
    .limit(1)
  return !!row
}

async function issueSession(c: Context<HonoEnv>, patientId: string): Promise<void> {
  const db = getDb(env.DATABASE_URL)
  const { raw, hash } = await generateToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)

  await db.insert(patientSessions).values({
    patientId,
    tokenHash: hash,
    expiresAt,
    userAgent: c.req.header('User-Agent') ?? null,
    ipAddress: getClientIp(c),
  })

  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60
  c.header('Set-Cookie', sessionCookieHeader(raw, maxAge), { append: true })
}

// Reads and validates the patient_session cookie.
// Returns { patient, sessionId } or null. Also bumps lastUsedAt.
async function getSessionPatient(c: Context<HonoEnv>): Promise<{
  patient: typeof patients.$inferSelect
  sessionId: string
} | null> {
  const cookieHeader = c.req.header('Cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))
  if (!match) return null

  const rawToken = match[1]
  const hash = await sha256Hex(rawToken)
  const db = getDb(env.DATABASE_URL)

  const [session] = await db
    .select()
    .from(patientSessions)
    .where(and(eq(patientSessions.tokenHash, hash), gt(patientSessions.expiresAt, new Date())))
    .limit(1)

  if (!session) return null

  // Bump lastUsedAt in the background — don't block the response
  db.update(patientSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(patientSessions.id, session.id))
    .catch(() => {})

  const [patient] = await db
    .select()
    .from(patients)
    .where(eq(patients.id, session.patientId))
    .limit(1)

  if (!patient) return null
  return { patient, sessionId: session.id }
}

// ─── POST /login ─────────────────────────────────────────────────────────────
// Body: { phone: string }
// Phone-anchored passwordless login:
//   - no enabled patient on phone → { success:false, enabled:false, error } (no OTP sent)
//   - trusted device              → { success:true, requiresOtp:false } (go to /profiles)
//   - untrusted device            → sends OTP, { success:true, requiresOtp:true, phoneHint }

patientAuthApp.post('/login', async (c) => {
  let body: { phone?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const rawPhone = body.phone?.trim()
  if (!rawPhone || !isValidPhoneNumber(rawPhone)) {
    return c.json({ error: 'Please enter a valid phone number' }, 400)
  }
  const phone = formatPhoneNumber(rawPhone)

  const db = getDb(env.DATABASE_URL)
  const enabledPatients = await findEnabledPatientsByPhone(db, phone)

  // Gate 1 (pre-OTP): no enabled patient on this phone → block, send no SMS.
  if (enabledPatients.length === 0) {
    return c.json({
      success: false,
      enabled: false,
      error:
        'This phone number has not been enabled to use the system. Kindly contact the administrator.',
    })
  }

  // Trusted device → skip OTP; client proceeds to the profile switcher.
  if (await isTrustedDeviceForPhone(db, phone, c)) {
    return c.json({ success: true, requiresOtp: false })
  }

  // Untrusted device → send a login OTP to the phone.
  const otp = await requestOtpByPhone(db, phone, 'login_phone')
  if (!otp.ok) {
    return c.json({ error: otp.error ?? 'Could not send verification code' }, 500)
  }
  return c.json({ success: true, requiresOtp: true, phoneHint: phone.slice(-4) })
})

// ─── POST /verify-login-otp ──────────────────────────────────────────────────
// Body: { phone: string, code: string }
// Verifies the login OTP and trusts this device for the phone (30d). Issues NO
// session yet — the client then calls /profiles and /select-profile.

patientAuthApp.post('/verify-login-otp', async (c) => {
  let body: { phone?: string; code?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const rawPhone = body.phone?.trim()
  const code = body.code?.trim()
  if (!rawPhone || !code) {
    return c.json({ error: 'phone and code are required' }, 400)
  }
  const phone = formatPhoneNumber(rawPhone)

  const db = getDb(env.DATABASE_URL)
  // Re-check enablement (defends against a phone disabled between login + verify).
  const enabledPatients = await findEnabledPatientsByPhone(db, phone)
  if (enabledPatients.length === 0) {
    return c.json({ error: 'This phone number is not enabled.' }, 403)
  }

  const result = await verifyOtpByPhone(db, phone, code, 'login_phone')
  if (!result.ok) {
    return c.json({ error: result.error ?? 'Invalid code' }, 401)
  }

  await trustDeviceForPhone(db, phone, c)
  return c.json({ success: true })
})

// ─── GET /profiles ───────────────────────────────────────────────────────────
// Lists the enabled patients reachable from the trusted phone (the family
// switcher). Enablement is re-checked server-side, so a patient disabled in the
// portal disappears immediately and a newly-enabled one appears without a fresh
// OTP. Requires a valid trusted-device cookie (the phone-auth proof).

patientAuthApp.get('/profiles', async (c) => {
  const db = getDb(env.DATABASE_URL)
  const phone = await getTrustedPhone(db, c)
  if (!phone) return c.json({ error: 'Not authenticated' }, 401)

  const enabledPatients = await findEnabledPatientsByPhone(db, phone)
  const template = await ensureAppConsentTemplate(db)
  const profiles = await Promise.all(
    enabledPatients.map(async (p) => ({
      ...(await patientPayload(db, p)),
      consentSigned: await hasSignedAppConsent(db, p.id, template.id),
    }))
  )
  return c.json({ success: true, profiles })
})

// ─── POST /select-profile ────────────────────────────────────────────────────
// Body: { patientId: string }  (patient.id uuid)
// Activates a profile from the trusted phone's group and issues a session.
// Switching profiles re-calls this — no new OTP (the device stays trusted).
// (Phase 3 will gate this behind a signed "Patient App Access" consent.)

patientAuthApp.post('/select-profile', async (c) => {
  let body: { patientId?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const targetId = body.patientId
  if (!targetId) return c.json({ error: 'patientId is required' }, 400)

  const db = getDb(env.DATABASE_URL)
  const phone = await getTrustedPhone(db, c)
  if (!phone) return c.json({ error: 'Not authenticated' }, 401)

  // The target must be one of the enabled patients on the trusted phone.
  const enabledPatients = await findEnabledPatientsByPhone(db, phone)
  const patient = enabledPatients.find((p) => p.id === targetId)
  if (!patient) {
    return c.json({ error: 'Profile not available for this phone' }, 403)
  }

  // Gate 2: require a signed "Patient App Access" consent before issuing a
  // session. Unsigned → return the consent form for the client to present.
  const template = await ensureAppConsentTemplate(db)
  if (!(await hasSignedAppConsent(db, patient.id, template.id))) {
    return c.json({
      success: false,
      consentRequired: true,
      patientId: patient.id,
      consent: { templateId: template.id, name: template.name, content: template.content },
    })
  }

  await issueSession(c, patient.id)
  return c.json({ success: true, patient: await patientPayload(db, patient) })
})

// ─── POST /sign-app-consent ──────────────────────────────────────────────────
// Body: { patientId, signatureData (base64 PNG data URL), signedByName, relationshipToPatient? }
// Records the patient's (or guardian's) "Patient App Access" consent, then issues
// the session — so signing and entry happen in one step. Self-signed: collectedById
// is null (no staff collector).

const ALLOWED_RELATIONSHIPS = new Set(['self', 'guardian', 'spouse', 'other'])

patientAuthApp.post('/sign-app-consent', async (c) => {
  let body: {
    patientId?: string
    signatureData?: string
    signedByName?: string
    relationshipToPatient?: string
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const targetId = body.patientId
  const signatureData = body.signatureData
  const signedByName = body.signedByName?.trim()
  const relationship = body.relationshipToPatient ?? 'self'

  if (!targetId || !signatureData || !signedByName) {
    return c.json({ error: 'patientId, signatureData and signedByName are required' }, 400)
  }
  if (!signatureData.startsWith('data:image/')) {
    return c.json({ error: 'Invalid signature' }, 400)
  }
  if (!ALLOWED_RELATIONSHIPS.has(relationship)) {
    return c.json({ error: 'Invalid relationship' }, 400)
  }

  const db = getDb(env.DATABASE_URL)
  const phone = await getTrustedPhone(db, c)
  if (!phone) return c.json({ error: 'Not authenticated' }, 401)

  const enabledPatients = await findEnabledPatientsByPhone(db, phone)
  const patient = enabledPatients.find((p) => p.id === targetId)
  if (!patient) {
    return c.json({ error: 'Profile not available for this phone' }, 403)
  }

  const template = await ensureAppConsentTemplate(db)
  // Idempotent: skip the insert if already signed (e.g. double-submit).
  if (!(await hasSignedAppConsent(db, patient.id, template.id))) {
    await db.insert(signedConsentForms).values({
      templateId: template.id,
      patientId: patient.id,
      signatureData,
      signedByName,
      relationshipToPatient: relationship,
      contentSnapshot: template.content,
      collectedById: null,
    })
  }

  await issueSession(c, patient.id)
  return c.json({ success: true, patient: await patientPayload(db, patient) })
})

// ─── GET /me ─────────────────────────────────────────────────────────────────

patientAuthApp.get('/me', async (c) => {
  const session = await getSessionPatient(c)
  if (!session) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(env.DATABASE_URL)
  return c.json({ success: true, patient: await patientPayload(db, session.patient) })
})

// ─── POST /logout ────────────────────────────────────────────────────────────
// Clears the session cookie + DB row. Does NOT revoke the trusted-device cookie
// — the device stays trusted for the phone so the next sign-in skips OTP.

patientAuthApp.post('/logout', async (c) => {
  const cookieHeader = c.req.header('Cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))

  if (match) {
    const rawToken = match[1]
    const hash = await sha256Hex(rawToken)
    const db = getDb(env.DATABASE_URL)
    await db.delete(patientSessions).where(eq(patientSessions.tokenHash, hash))
  }

  c.header('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttrs()}; Max-Age=0`, { append: true })
  return c.json({ success: true })
})

// ─── POST /forget-this-device ────────────────────────────────────────────────
// Authenticated. Clears the trust cookie on the calling device only — next
// login from this device requires a fresh OTP. Other devices unaffected.

patientAuthApp.post('/forget-this-device', async (c) => {
  const session = await getSessionPatient(c)
  if (!session) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(env.DATABASE_URL)
  await clearCurrentDeviceTrust(db, c)
  return c.json({ success: true })
})

// ─── GET /sessions ───────────────────────────────────────────────────────────
// Returns all active sessions for the authenticated patient.

patientAuthApp.get('/sessions', async (c) => {
  const session = await getSessionPatient(c)
  if (!session) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(env.DATABASE_URL)
  const rows = await db
    .select({
      id: patientSessions.id,
      userAgent: patientSessions.userAgent,
      ipAddress: patientSessions.ipAddress,
      lastUsedAt: patientSessions.lastUsedAt,
      createdAt: patientSessions.createdAt,
    })
    .from(patientSessions)
    .where(
      and(
        eq(patientSessions.patientId, session.patient.id),
        gt(patientSessions.expiresAt, new Date())
      )
    )

  const data = rows.map((r) => ({ ...r, isCurrent: r.id === session.sessionId }))
  return c.json({ success: true, data })
})

// ─── DELETE /sessions/:id ────────────────────────────────────────────────────
// Revokes a specific session by id. Patients can only revoke their own sessions.

patientAuthApp.delete('/sessions/:id', async (c) => {
  const session = await getSessionPatient(c)
  if (!session) return c.json({ error: 'Not authenticated' }, 401)

  const targetId = c.req.param('id')
  const db = getDb(env.DATABASE_URL)

  const [target] = await db
    .select({ id: patientSessions.id })
    .from(patientSessions)
    .where(and(eq(patientSessions.id, targetId), eq(patientSessions.patientId, session.patient.id)))
    .limit(1)

  if (!target) return c.json({ error: 'Session not found' }, 404)

  await db.delete(patientSessions).where(eq(patientSessions.id, targetId))

  if (targetId === session.sessionId) {
    c.header('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttrs()}; Max-Age=0`, { append: true })
  }

  return c.json({ success: true })
})

export { getSessionPatient, patientAuthApp }
