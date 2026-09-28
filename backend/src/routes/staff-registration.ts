/**
 * Staff self-registration — public onboarding form + HR review/approval.
 *
 * Flow:
 *   1. HR generates a one-time invite link (24h expiry).            [HR, auth]
 *   2. New staff opens team.deneldental.com/register/:token, verifies their
 *      phone by SMS-OTP, fills the 4 staff-owned sections, uploads
 *      an optional CV, consents, and submits.                       [public]
 *   3. HR reviews the submission, sets the admin-only Access fields
 *      (staff type, device ID, capability flags, role, scopes), and
 *      approves — which provisions the real staff account (phone+OTP
 *      login, throwaway password) — or rejects.                     [HR, auth]
 *
 * The invite row carries its own OTP columns because there is no `staff`
 * row yet at verification time (staff-otp.ts keys on staffId, so it can't
 * be reused here).
 *
 * Mounted at /api/staff-registration (a separate router from staff-core so
 * the public `/public/:token/*` paths never collide with staff-core's
 * authenticated `/:id` routes).
 */

import { deriveBirthDayMonth, registrationSubmitSchema } from '@denel/types'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { env, isDevEnvironment } from '../config/env'
import { getDb } from '../db'
import {
  account,
  attendanceEvents,
  hrDepartments,
  specialists,
  staff,
  staffRegistrationInvites,
  staffTitles,
  twoFactor,
  user,
  userBundles,
  userScopes,
} from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { getBranding } from '../lib/branding'
import { DEFAULT_EMPLOYMENT_TYPE, resolveEmploymentType } from '../lib/employment-type'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { hashPassword } from '../lib/password'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { sendSMS } from '../lib/sms'
import { syncPersonalChildRecords } from '../lib/staff-personal-sync'
import { uploadToCategory } from '../lib/storage-router'
import type { HonoEnv } from '../lib/types'
import { formatPhoneNumber } from '../lib/utils/phone'

const app = new Hono<HonoEnv>()

const MODULE = MODULES.STAFF as string

// Roles assignable to a staff member — mirrors VALID_STAFF_ROLES in
// access-management.ts (the canonical role writer). RBAC permissions resolve off
// `user.roleId`, so approval must set that (not just the Better-Auth `role`).
const VALID_STAFF_ROLES = new Set([
  'admin',
  'doctor',
  'receptionist',
  'lab_technician',
  'external_trainer',
  'staff',
])

const INVITE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const OTP_TTL_MS = 10 * 60 * 1000 // 10 minutes
const OTP_MAX_ATTEMPTS = 5
const OTP_RESEND_COOLDOWN_MS = 45 * 1000 // don't let a code be re-sent within 45s
const MAX_CV_BYTES = 8 * 1024 * 1024 // 8 MB

// ── crypto helpers ───────────────────────────────────────────────────────────

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function generateNumericCode(length: number): string {
  const digits: string[] = []
  while (digits.length < length) {
    const buf = crypto.getRandomValues(new Uint8Array(length))
    for (const b of buf) {
      if (b < 250) digits.push(String(b % 10))
      if (digits.length === length) break
    }
  }
  return digits.join('')
}

async function sha256Hex(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Next Staff ID in format FDM-S0001 (uses MAX so it's safe after deletions). */
async function generateStaffId(db: ReturnType<typeof getDb>): Promise<string> {
  const [result] = await db
    .select({
      maxNum: sql<number>`max(cast(regexp_replace("staffId", '[^0-9]', '', 'g') as int))`,
    })
    .from(staff)
  const next = (result?.maxNum ?? 0) + 1
  return `FDM-S${String(next).padStart(4, '0')}`
}

// Lazy so we never read the env proxy at module-eval time — the route module is
// imported before validateBackendEnv() runs, and the proxy throws until then.
// Fails CLOSED. This used to be `env.APP_ENV !== 'production'`, and APP_ENV is
// set in no Doppler config — so on a deployment it was TRUE, and the
// send-otp handler below returned `devCode` (the registration OTP) in the
// HTTP response body. resolvedEnvironment() treats anything unrecognised as
// production.
const isDev = () => isDevEnvironment()

// ── Types ────────────────────────────────────────────────────────────────────

type SubmittedData = Record<string, unknown>

// ─────────────────────────────────────────────────────────────────────────────
// HR — generate a one-time invite link
// POST /api/staff-registration/invites   { note? }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/invites', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json().catch(() => ({}) as { note?: string })
    const db = getDb(process.env.DATABASE_URL!)
    const token = randomToken()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS)

    const [invite] = await db
      .insert(staffRegistrationInvites)
      .values({
        token,
        status: 'pending',
        createdByUserId: authUser.id,
        note: typeof body?.note === 'string' ? body.note.slice(0, 500) : null,
        expiresAt,
      })
      .returning()

    return c.json({
      success: true,
      data: {
        id: invite.id,
        token,
        // The HR client prefixes this with the Team app origin to build the
        // full link (team.deneldental.com/register/:token in prod).
        path: `/register/${token}`,
        expiresAt: expiresAt.toISOString(),
      },
    })
  } catch (error) {
    logError(error, { context: '[staff-registration] generate invite' })
    return c.json({ error: 'Failed to generate invite link' }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// HR — list invites (for the Pending Registrations review UI)
// GET /api/staff-registration/invites?status=submitted
// ─────────────────────────────────────────────────────────────────────────────
app.get('/invites', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const statusFilter = c.req.query('status')
    const rows = await db
      .select()
      .from(staffRegistrationInvites)
      .orderBy(desc(staffRegistrationInvites.createdAt))

    const now = Date.now()
    const list = rows
      .map((r) => {
        // Lazily reflect expiry in the returned status (persisted lazily on read below).
        const expired = r.status === 'pending' && r.expiresAt.getTime() < now
        const data = (r.submittedData ?? {}) as SubmittedData
        return {
          id: r.id,
          status: expired ? 'expired' : r.status,
          note: r.note,
          fullName: (data.fullName as string) ?? null,
          phone: r.verifiedPhone ?? (data.phone as string) ?? null,
          title: (data.title as string) ?? null,
          department: (data.department as string) ?? null,
          phoneVerified: r.phoneVerified,
          cvUrl: r.cvUrl,
          staffId: r.staffId,
          reviewNotes: r.reviewNotes,
          expiresAt: r.expiresAt.toISOString(),
          submittedAt: r.submittedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        }
      })
      .filter((r) => (statusFilter ? r.status === statusFilter : true))

    return c.json({ success: true, data: list })
  } catch (error) {
    logError(error, { context: '[staff-registration] list invites' })
    return c.json({ error: 'Failed to load invites' }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// HR — full detail of one invite (submitted payload for the review sheet)
// GET /api/staff-registration/invites/:id
// ─────────────────────────────────────────────────────────────────────────────
app.get('/invites/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const [row] = await db
      .select()
      .from(staffRegistrationInvites)
      .where(eq(staffRegistrationInvites.id, c.req.param('id')))
    if (!row) return c.json({ error: 'Invite not found' }, 404)

    return c.json({
      success: true,
      data: {
        id: row.id,
        status: row.status,
        note: row.note,
        submittedData: (row.submittedData ?? {}) as SubmittedData,
        verifiedPhone: row.verifiedPhone,
        phoneVerified: row.phoneVerified,
        cvUrl: row.cvUrl,
        staffId: row.staffId,
        reviewNotes: row.reviewNotes,
        expiresAt: row.expiresAt.toISOString(),
        submittedAt: row.submittedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      },
    })
  } catch (error) {
    logError(error, { context: '[staff-registration] get invite' })
    return c.json({ error: 'Failed to load invite' }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — active clinical titles for the registration Title dropdown.
// (The /api/lookups/* endpoints are auth-gated; the register page has no
// session, so it reads titles here.) Registered before /public/:token so the
// static path always wins.
// GET /api/staff-registration/public/titles
// ─────────────────────────────────────────────────────────────────────────────
app.get('/public/titles', async (c) => {
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const rows = await db
      .select({ id: staffTitles.id, name: staffTitles.name, displayName: staffTitles.displayName })
      .from(staffTitles)
      .where(eq(staffTitles.isActive, true))
      .orderBy(staffTitles.displayName)
    return c.json({ success: true, data: rows })
  } catch (error) {
    logError(error, { context: '[staff-registration] public titles' })
    return c.json({ success: true, data: [] })
  }
})

// PUBLIC — active departments for the registration Department dropdown.
// Same rationale as /public/titles: the register page is unauthenticated, so it
// can't use the auth-gated /api/lookups/hr-departments. Department became an
// admin-managed lookup in migration 0178.
// GET /api/staff-registration/public/departments
app.get('/public/departments', async (c) => {
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const rows = await db
      .select({
        id: hrDepartments.id,
        name: hrDepartments.name,
        displayName: hrDepartments.displayName,
      })
      .from(hrDepartments)
      .where(eq(hrDepartments.isActive, true))
      .orderBy(hrDepartments.displayName)
    return c.json({ success: true, data: rows })
  } catch (error) {
    logError(error, { context: '[staff-registration] public departments' })
    return c.json({ success: true, data: [] })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — validate a token (the register page calls this on load)
// GET /api/staff-registration/public/:token
// ─────────────────────────────────────────────────────────────────────────────
app.get('/public/:token', async (c) => {
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const token = c.req.param('token')
    const [inv] = await db
      .select()
      .from(staffRegistrationInvites)
      .where(eq(staffRegistrationInvites.token, token))

    if (!inv) return c.json({ valid: false, reason: 'not_found' })

    const now = Date.now()
    if (inv.status === 'approved')
      return c.json({ valid: false, reason: 'already_approved', status: inv.status })
    if (inv.status === 'rejected')
      return c.json({ valid: false, reason: 'rejected', status: inv.status })
    if (inv.status === 'submitted')
      return c.json({ valid: false, reason: 'already_submitted', status: inv.status })
    if (inv.expiresAt.getTime() < now) {
      if (inv.status !== 'expired') {
        await db
          .update(staffRegistrationInvites)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(staffRegistrationInvites.id, inv.id))
      }
      return c.json({ valid: false, reason: 'expired', status: 'expired' })
    }

    return c.json({
      valid: true,
      status: inv.status,
      expiresAt: inv.expiresAt.toISOString(),
      phoneVerified: inv.phoneVerified,
      verifiedPhone: inv.verifiedPhone,
    })
  } catch (error) {
    logError(error, { context: '[staff-registration] validate token' })
    return c.json({ valid: false, reason: 'error' }, 500)
  }
})

/** Load a still-usable (pending, unexpired) invite by token, or null. */
async function loadUsableInvite(db: ReturnType<typeof getDb>, token: string) {
  const [inv] = await db
    .select()
    .from(staffRegistrationInvites)
    .where(eq(staffRegistrationInvites.token, token))
  if (!inv) return { inv: null as null, reason: 'not_found' as const }
  if (inv.status !== 'pending')
    return { inv: null as null, reason: 'not_pending' as const, status: inv.status }
  if (inv.expiresAt.getTime() < Date.now()) return { inv: null as null, reason: 'expired' as const }
  return { inv, reason: 'ok' as const }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — send an OTP to the staff-entered phone (gate before the form opens)
// POST /api/staff-registration/public/:token/send-otp   { phone }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/public/:token/send-otp', async (c) => {
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const token = c.req.param('token')
    const body = (await c.req.json().catch(() => ({}))) as { phone?: string }
    const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : ''
    if (!rawPhone) return c.json({ error: 'Phone number is required' }, 400)
    const phone = formatPhoneNumber(rawPhone)

    const { inv, reason } = await loadUsableInvite(db, token)
    if (!inv) return c.json({ error: 'This registration link is no longer valid.', reason }, 400)

    // Re-send cooldown — a fresh code was just sent.
    if (
      inv.otpExpiresAt &&
      inv.otpExpiresAt.getTime() - OTP_TTL_MS + OTP_RESEND_COOLDOWN_MS > Date.now()
    ) {
      return c.json({ error: 'Please wait a moment before requesting another code.' }, 429)
    }

    const code = generateNumericCode(6)
    const otpHash = await sha256Hex(code)
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS)

    await db
      .update(staffRegistrationInvites)
      .set({ otpHash, otpPhone: phone, otpExpiresAt, otpAttempts: 0, updatedAt: new Date() })
      .where(eq(staffRegistrationInvites.id, inv.id))

    const branding = await getBranding().catch(() => null)
    const brandShort = branding?.shortName ?? 'Denel'
    const smsRes = await sendSMS([
      {
        phone,
        message: `${brandShort}: your staff registration code is ${code}. Valid for 10 minutes.`,
      },
    ])

    if (!smsRes.success && !isDev()) {
      return c.json({ error: 'Failed to send SMS. Please try again.' }, 502)
    }

    // In non-production, return the code so the flow is testable without SMS.
    return c.json({
      success: true,
      phoneHint: phone.slice(-4),
      ...(isDev() ? { devCode: code } : {}),
    })
  } catch (error) {
    logError(error, { context: '[staff-registration] send otp' })
    return c.json({ error: 'Failed to send code' }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — verify the OTP (unlocks the form)
// POST /api/staff-registration/public/:token/verify-otp   { phone, code }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/public/:token/verify-otp', async (c) => {
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const token = c.req.param('token')
    const body = (await c.req.json().catch(() => ({}))) as { phone?: string; code?: string }
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const phone = typeof body.phone === 'string' ? formatPhoneNumber(body.phone.trim()) : ''

    if (!/^\d{6}$/.test(code)) return c.json({ error: 'Enter the 6-digit code.' }, 400)

    const { inv, reason } = await loadUsableInvite(db, token)
    if (!inv) return c.json({ error: 'This registration link is no longer valid.', reason }, 400)

    if (!inv.otpHash || !inv.otpExpiresAt || !inv.otpPhone)
      return c.json({ error: 'Request a code first.' }, 400)
    if (inv.otpPhone !== phone)
      return c.json({ error: 'Phone number does not match the one you entered.' }, 400)
    if (inv.otpExpiresAt.getTime() < Date.now())
      return c.json({ error: 'Code expired. Request a new one.' }, 400)
    if (inv.otpAttempts >= OTP_MAX_ATTEMPTS)
      return c.json({ error: 'Too many wrong attempts. Request a new code.' }, 429)

    const candidate = await sha256Hex(code)
    if (candidate !== inv.otpHash) {
      await db
        .update(staffRegistrationInvites)
        .set({ otpAttempts: inv.otpAttempts + 1, updatedAt: new Date() })
        .where(eq(staffRegistrationInvites.id, inv.id))
      const remaining = OTP_MAX_ATTEMPTS - inv.otpAttempts - 1
      return c.json(
        {
          error:
            remaining > 0
              ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
              : 'Too many wrong attempts. Request a new code.',
        },
        400
      )
    }

    await db
      .update(staffRegistrationInvites)
      .set({
        phoneVerified: true,
        verifiedPhone: phone,
        otpHash: null,
        updatedAt: new Date(),
      })
      .where(eq(staffRegistrationInvites.id, inv.id))

    return c.json({ success: true, verifiedPhone: phone })
  } catch (error) {
    logError(error, { context: '[staff-registration] verify otp' })
    return c.json({ error: 'Failed to verify code' }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — CV upload (optional). multipart/form-data, field `file`.
// POST /api/staff-registration/public/:token/cv
// ─────────────────────────────────────────────────────────────────────────────
app.post('/public/:token/cv', async (c) => {
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const token = c.req.param('token')
    const { inv } = await loadUsableInvite(db, token)
    if (!inv) return c.json({ error: 'This registration link is no longer valid.' }, 400)
    if (!inv.phoneVerified) return c.json({ error: 'Verify your phone first.' }, 403)

    const form = await c.req.parseBody()
    const file = form.file
    if (!file || typeof file === 'string') return c.json({ error: 'No file uploaded.' }, 400)

    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png',
      'image/jpeg',
    ]
    if (!allowed.includes(file.type))
      return c.json({ error: 'CV must be a PDF, Word doc, or image.' }, 400)

    const buf = Buffer.from(await file.arrayBuffer())
    if (buf.byteLength > MAX_CV_BYTES) return c.json({ error: 'CV is too large (max 8 MB).' }, 400)

    const ext =
      file.type === 'application/pdf'
        ? 'pdf'
        : file.type.includes('word')
          ? 'docx'
          : file.type === 'image/png'
            ? 'png'
            : 'jpg'
    // Private: HR opens the CV through a short-lived link the API edge issues.
    const key = `staff/registration/${inv.id}/cv-${randomToken().slice(0, 12)}.${ext}`
    const { url } = await uploadToCategory('staff', key, buf, file.type)

    await db
      .update(staffRegistrationInvites)
      .set({ cvUrl: url, updatedAt: new Date() })
      .where(eq(staffRegistrationInvites.id, inv.id))

    return c.json({ success: true, url })
  } catch (error) {
    logError(error, { context: '[staff-registration] cv upload' })
    return c.json({ error: 'Failed to upload CV' }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — submit the completed form
// POST /api/staff-registration/public/:token/submit   { ...staff fields }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/public/:token/submit', async (c) => {
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const token = c.req.param('token')
    const { inv, reason } = await loadUsableInvite(db, token)
    if (!inv) return c.json({ error: 'This registration link is no longer valid.', reason }, 400)
    if (!inv.phoneVerified || !inv.verifiedPhone)
      return c.json({ error: 'Verify your phone before submitting.' }, 403)

    const body = (await c.req.json().catch(() => ({}))) as SubmittedData

    // Validate against the canonical registration contract in @denel/types —
    // the same module the HR wizard, the HR profile editors and POST/PATCH
    // /api/staff all build on. This replaces a hand-rolled 19-entry required
    // list that had already drifted from what the form actually collects, and
    // it caps the payload: `submittedData` is raw JSONB, so before this an
    // unvalidated body of any size or shape was persisted verbatim.
    //
    // zod strips unknown keys rather than rejecting them, so a client sending
    // extra fields still works — they just never reach the DB.
    const parsed = registrationSubmitSchema.safeParse(body)
    if (!parsed.success) {
      // Surface every missing/invalid field at once, as the old handler did —
      // a form with 19 required fields is miserable to fix one error at a time.
      const problems = parsed.error.issues.map((i) => i.message)
      const unique = [...new Set(problems)]
      return c.json({ error: `Please complete: ${unique.join(', ')}` }, 400)
    }

    // Phone is fixed to the OTP-verified number — never trust a form-supplied one.
    const submittedData: SubmittedData = {
      ...parsed.data,
      phone: inv.verifiedPhone,
      consentGiven: true,
      consentAt: new Date().toISOString(),
    }

    await db
      .update(staffRegistrationInvites)
      .set({
        submittedData,
        status: 'submitted',
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(staffRegistrationInvites.id, inv.id))

    return c.json({ success: true })
  } catch (error) {
    logError(error, { context: '[staff-registration] submit' })
    return c.json({ error: 'Failed to submit registration' }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// HR — reject a submission
// POST /api/staff-registration/invites/:id/reject   { reason? }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/invites/:id/reject', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string }
    const [inv] = await db
      .select()
      .from(staffRegistrationInvites)
      .where(eq(staffRegistrationInvites.id, id))
    if (!inv) return c.json({ error: 'Invite not found' }, 404)
    if (inv.status === 'approved')
      return c.json({ error: 'Already approved — cannot reject.' }, 409)

    await db
      .update(staffRegistrationInvites)
      .set({
        status: 'rejected',
        reviewNotes: typeof body.reason === 'string' ? body.reason.slice(0, 500) : null,
        reviewedByUserId: authUser.id,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(staffRegistrationInvites.id, id))

    return c.json({ success: true })
  } catch (error) {
    logError(error, { context: '[staff-registration] reject' })
    return c.json({ error: 'Failed to reject registration' }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// HR — approve a submission → provision the staff account
// POST /api/staff-registration/invites/:id/approve   { admin fields }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/invites/:id/approve', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  let createdUserId: string | null = null

  try {
    const admin = (await c.req.json().catch(() => ({}))) as {
      staffType?: 'internal' | 'external'
      deviceUserId?: string
      /**
       * Admin decision made at approval — the registrant never states it.
       * Falls back to 'permanent' when the HR reviewer doesn't set it, which
       * preserves the old behaviour for the existing approval UI.
       */
      employmentType?: string
      positionTag?: 'staff' | 'non_staff'
      isClinicalPractitioner?: boolean
      receivesCommission?: boolean
      hasPayslip?: boolean
      tracksAttendance?: boolean
      requiresLicense?: boolean
      salaryBand?: string
      role?: string
      scopes?: string[]
      specialist?: {
        defaultCommissionRate?: number | string
        withholdingTaxRate?: number | string
        payoutMethod?: string
        tin?: string
      }
    }

    const [inv] = await db
      .select()
      .from(staffRegistrationInvites)
      .where(eq(staffRegistrationInvites.id, id))
    if (!inv) return c.json({ error: 'Invite not found' }, 404)
    if (inv.status === 'approved')
      return c.json({ error: 'This registration was already approved.' }, 409)
    if (inv.status !== 'submitted')
      return c.json({ error: 'Only submitted registrations can be approved.' }, 409)

    const data = (inv.submittedData ?? {}) as SubmittedData
    const fullName = String(data.fullName ?? '').trim()
    const phone = inv.verifiedPhone ?? String(data.phone ?? '').trim()
    if (!fullName || !phone) return c.json({ error: 'Submission is missing name or phone.' }, 400)

    // Phone must remain unique across active staff (it's the OTP-login identity).
    const normalized = formatPhoneNumber(phone)
    const actives = await db
      .select({ fullName: staff.fullName, phone: staff.phone })
      .from(staff)
      .where(isNull(staff.deletedAt))
    const clash = actives.find((s) => s.phone && formatPhoneNumber(s.phone) === normalized)
    if (clash)
      return c.json(
        { error: `Phone number is already assigned to another staff (${clash.fullName}).` },
        409
      )

    // Device ID uniqueness (if the admin assigned one).
    const deviceUserId =
      typeof admin.deviceUserId === 'string' && admin.deviceUserId.trim()
        ? admin.deviceUserId.trim()
        : null
    if (deviceUserId) {
      const existingDevice = await db
        .select({ fullName: staff.fullName })
        .from(staff)
        .where(eq(staff.deviceUserId, deviceUserId))
      if (existingDevice[0])
        return c.json(
          {
            error: `Device User ID "${deviceUserId}" is already assigned (${existingDevice[0].fullName}).`,
          },
          409
        )
    }

    const staffId = await generateStaffId(db)
    const now = new Date()
    const userId = crypto.randomUUID()
    createdUserId = userId

    // Email is optional on the form; Better Auth's user table needs a unique
    // email, so synthesize a non-routable one when none was given. Login is
    // phone+OTP so this address is never used to sign in.
    const providedEmail = String(data.email ?? '').trim()
    const email = providedEmail || `${staffId.toLowerCase()}@staff.framada.local`

    if (providedEmail) {
      const [existing] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, providedEmail))
      if (existing) return c.json({ error: 'Email already exists in the system.' }, 409)
    }

    // Passwordless: mint a random throwaway password (never used — phone+OTP login).
    const throwaway = `${randomToken()}${randomToken()}`
    const hashedPw = await hashPassword(throwaway)

    // RBAC permissions resolve off `user.roleId`, so we must set it (not just the
    // Better-Auth `role`). Mirror the canonical role writer (access-management
    // PATCH /staff/:id/role → `role: nextRole, roleId: nextRole`). Invalid/absent
    // → null (staff gets only bundle_pwa_standard until HR assigns a role).
    const chosenRole =
      typeof admin.role === 'string' && VALID_STAFF_ROLES.has(admin.role) ? admin.role : null

    await db.insert(user).values({
      id: userId,
      name: fullName,
      email,
      phone,
      emailVerified: true,
      role: chosenRole,
      roleId: chosenRole,
      banned: false,
      username: staffId.toLowerCase(),
      displayUsername: staffId,
      twoFactorEnabled: true,
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: hashedPw,
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(twoFactor).values({
      id: crypto.randomUUID(),
      userId,
      secret: crypto.randomUUID(),
      backupCodes: '[]',
      verified: true,
    })

    // Resolve capability flags (admin overrides, else staffType-driven defaults).
    const resolvedStaffType: 'internal' | 'external' =
      admin.staffType === 'external' ? 'external' : 'internal'
    const isExternalDerived = resolvedStaffType === 'external'
    const resolvedPositionTag: 'staff' | 'non_staff' =
      admin.positionTag === 'non_staff' || admin.positionTag === 'staff'
        ? admin.positionTag
        : isExternalDerived
          ? 'non_staff'
          : 'staff'
    const flag = (value: unknown, fallback: boolean) =>
      typeof value === 'boolean' ? value : fallback
    const isClinicalPractitioner = flag(admin.isClinicalPractitioner, false)
    const receivesCommission = flag(admin.receivesCommission, isExternalDerived)
    const hasPayslip = flag(admin.hasPayslip, !isExternalDerived)
    const tracksAttendance = flag(
      admin.tracksAttendance,
      !isExternalDerived && resolvedPositionTag === 'staff'
    )
    const requiresLicense = flag(admin.requiresLicense, isClinicalPractitioner)

    // Title displayName → staff.position; department & new personal/education
    // fields land in their own columns.
    const title = String(data.title ?? '').trim() || null
    const department = String(data.department ?? '').trim() || null
    const dateOfJoining = data.dateOfJoining ? new Date(String(data.dateOfJoining)) : now
    const qualYear = Number(data.qualificationYear)

    // Employment type is an ADMIN decision made at approval, not something the
    // registrant states. It used to be hard-coded 'permanent', so every
    // self-registered contractor/intern/consultant was silently filed as
    // permanent and HR had to notice and fix it afterwards.
    // Resolved against the admin-managed lookup (0178) rather than a hard-coded
    // enum, so a type HR added themselves is honoured. Unknown/deactivated
    // slugs fall back rather than 400, because the type is optional here — the
    // approval UI doesn't send one yet.
    const resolved = await resolveEmploymentType(db, admin.employmentType as string)
    const resolvedEmploymentType = resolved?.name ?? DEFAULT_EMPLOYMENT_TYPE

    // The birthday-reminder feature reads birthDay/birthMonth, NOT dateOfBirth.
    // This handler wrote only dateOfBirth, so every self-registered staffer was
    // invisible to it. Migration 0176 backfills the existing rows; this keeps
    // new approvals correct. Same derivation the staff routes use.
    const { birthDay, birthMonth } = deriveBirthDayMonth(
      data.dateOfBirth ? String(data.dateOfBirth) : null
    )

    const [newStaff] = await db
      .insert(staff)
      .values({
        staffId,
        userId,
        fullName,
        username: providedEmail ? providedEmail.split('@')[0] : staffId.toLowerCase(),
        email,
        phone,
        position: title,
        employmentType: resolvedEmploymentType,
        dateOfJoining,
        status: 'active',
        deviceUserId,
        staffType: resolvedStaffType,
        profileImage: (data.profileImage as string) || null,
        // Emergency (§4)
        emergencyContactName: (data.emergencyContactName as string) || null,
        emergencyContactRelationship: (data.emergencyContactRelationship as string) || null,
        emergencyContactPhone: (data.emergencyContactPhone as string) || null,
        // Personal (§1)
        dateOfBirth: data.dateOfBirth ? new Date(String(data.dateOfBirth)) : null,
        birthDay,
        birthMonth,
        gender: (data.gender as string) || null,
        ghanaCardPin: (data.ghanaCardPin as string) || null,
        nationality: (data.nationality as string) || 'Ghanaian',
        maritalStatus: (data.maritalStatus as string) || null,
        residentialAddress: (data.residentialAddress as string) || null,
        digitalAddress: (data.digitalAddress as string) || null,
        nextOfKinName: (data.nextOfKinName as string) || null,
        nextOfKinRelationship: (data.nextOfKinRelationship as string) || null,
        nextOfKinPhone: (data.nextOfKinPhone as string) || null,
        // Education (§3)
        highestQualification: (data.highestQualification as string) || null,
        institution: (data.institution as string) || null,
        qualificationYear: Number.isFinite(qualYear) ? qualYear : null,
        // Employment (§2)
        department,
        ssnitId: (data.ssnitId as string) || null,
        bankName: (data.bankName as string) || null,
        bankAccountName: (data.bankAccountName as string) || null,
        bankAccountNumber: (data.bankAccountNumber as string) || null,
        momoNetwork: (data.momoNetwork as string) || null,
        momoNumber: (data.momoNumber as string) || null,
        salaryBand: admin.salaryBand || null,
        // Consent (Act 843)
        consentGiven: true,
        consentAt: data.consentAt ? new Date(String(data.consentAt)) : now,
        cvUrl: inv.cvUrl || null,
        // Capability flags (admin)
        positionTag: resolvedPositionTag,
        isClinicalPractitioner,
        receivesCommission,
        hasPayslip,
        tracksAttendance,
        requiresLicense,
        isExternal: isExternalDerived,
      })
      .returning()

    // Mirror the flat personal data into the child tables (migration 0177) —
    // same as the HR create path, so both intake routes land identical records.
    await syncPersonalChildRecords(db, newStaff.id, {
      emergencyContactName: data.emergencyContactName as string,
      emergencyContactRelationship: data.emergencyContactRelationship as string,
      emergencyContactPhone: data.emergencyContactPhone as string,
      nextOfKinName: data.nextOfKinName as string,
      nextOfKinRelationship: data.nextOfKinRelationship as string,
      nextOfKinPhone: data.nextOfKinPhone as string,
      highestQualification: data.highestQualification as string,
      institution: data.institution as string,
      qualificationYear: Number.isFinite(qualYear) ? qualYear : null,
    })

    // Claim any orphaned attendance punches for this device ID.
    if (deviceUserId) {
      await db
        .update(attendanceEvents)
        .set({ staffId: newStaff.id })
        .where(
          and(eq(attendanceEvents.deviceUserId, deviceUserId), isNull(attendanceEvents.staffId))
        )
    }

    // Clinical practitioner → also create the specialists row (canonical FK
    // target for appointments/commissions).
    if (isClinicalPractitioner) {
      const sp = admin.specialist ?? {}
      const [createdSpecialist] = await db
        .insert(specialists)
        .values({
          name: fullName,
          contactEmail: email,
          contactPhone: phone,
          tin: sp.tin || (data.ghanaCardPin as string) || null,
          specialistType: isExternalDerived ? 'external' : 'internal',
          userId: isExternalDerived ? null : userId,
          defaultCommissionRate: receivesCommission ? Number(sp.defaultCommissionRate ?? 0) : 0,
          withholdingTaxRate: Number(sp.withholdingTaxRate ?? 0),
          payoutMethod: sp.payoutMethod || null,
          isActive: true,
          staffId: newStaff.id,
        })
        .returning()
      await db
        .update(staff)
        .set({ specialistId: createdSpecialist.id })
        .where(eq(staff.id, newStaff.id))
    }

    // Interface scopes — the Team app by default, like every HR onboarding.
    // Every other app follows the role chosen above (role_scopes); a caller
    // may still send an explicit 'portal'/'hr' grant as a one-off exception.
    // Denials are never written: user_scopes overrides the role, so the old
    // default `granted: false` rows kept an approved receptionist out of the
    // portal (and anyone later made hr_admin out of HR) for good.
    const wantScopes = new Set<string>(
      Array.isArray(admin.scopes) && admin.scopes.length ? admin.scopes : ['pwa']
    )
    const scopeRows = (['pwa', 'portal', 'hr'] as const)
      .filter((interfaceScope) => wantScopes.has(interfaceScope))
      .map((interfaceScope) => ({
        userId,
        interfaceScope,
        granted: true,
        grantedById: authUser.id,
        createdAt: now,
        updatedAt: now,
      }))
    if (scopeRows.length > 0) await db.insert(userScopes).values(scopeRows)

    if (resolvedPositionTag === 'staff') {
      await db
        .insert(userBundles)
        .values({
          userId,
          bundleId: 'bundle_pwa_standard',
          grantedById: authUser.id,
          grantSource: 'auto_position_tag',
        })
        .onConflictDoNothing()
    }

    // Mark the invite approved + link the new staff row.
    await db
      .update(staffRegistrationInvites)
      .set({
        status: 'approved',
        staffId: newStaff.id,
        reviewedByUserId: authUser.id,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(staffRegistrationInvites.id, id))

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'create',
      module: 'staff',
      entityId: newStaff.id,
      entityName: newStaff.fullName,
      changes: { staffId, via: 'self_registration', inviteId: id },
    })

    return c.json({
      success: true,
      data: {
        staffId: newStaff.id,
        generatedStaffId: staffId,
        userId,
        message: `Staff account created. Staff ID: ${staffId}. Login: phone ${phone} + OTP.`,
      },
    })
  } catch (error) {
    // Manual rollback of the auth user/account if the staff insert failed.
    if (createdUserId) {
      await db
        .delete(account)
        .where(eq(account.userId, createdUserId))
        .catch(() => {})
      await db
        .delete(user)
        .where(eq(user.id, createdUserId))
        .catch(() => {})
    }
    logError(error, { context: '[staff-registration] approve' })
    type PgErr = { code?: string; constraint?: string; detail?: string; cause?: PgErr }
    const pg = error as PgErr
    const cause = pg.cause ?? pg
    if (cause?.code === '23505') {
      return c.json({ error: cause.detail || 'Duplicate value violates a unique constraint.' }, 409)
    }
    return c.json({ error: 'Failed to approve registration' }, 500)
  }
})

// DELETE /api/staff-registration/invites/:id
app.delete('/invites/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const [existing] = await db
      .select({ id: staffRegistrationInvites.id, status: staffRegistrationInvites.status })
      .from(staffRegistrationInvites)
      .where(eq(staffRegistrationInvites.id, id))
      .limit(1)

    if (!existing) return c.json({ error: 'Not found' }, 404)

    if (existing.status === 'approved') {
      return c.json({ error: 'Cannot delete approved registration records' }, 400)
    }

    await db.delete(staffRegistrationInvites).where(eq(staffRegistrationInvites.id, id))

    await createAuditLog(db, {
      userId: authUser.id,
      action: 'delete',
      module: MODULE,
      entityId: id,
      entityName: `Staff registration invite ${id}`,
    })

    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { context: '[staff-registration] delete invite' })
    return c.json({ error: 'Failed to delete invite' }, 500)
  }
})

export { app as staffRegistrationApp }
