/**
 * F01 follow-on — the patient app's reminder feed lists the patient's own rows
 * from `sms_messages`. Once login codes are stored as a redaction stand-in, the
 * feed must not show those stand-ins as if they were reminders.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F01).
 *
 * Real route, real database. Only the patient session lookup is stubbed (a real
 * patient login needs the very code that is no longer stored anywhere readable).
 *
 * ── Safety ── commits fixtures; local Postgres only; cleans up after itself.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/patient-reminders-feed.test.ts
 */
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const RAW_DB_URL = process.env.DATABASE_URL ?? ''
const IS_LOCAL = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(RAW_DB_URL)
const skip = !IS_LOCAL

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost:5433/framada',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
  isSelfHealEnabled: () => false,
  isDevEnvironment: () => false,
  resolvedEnvironment: () => 'production',
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/routes/patient-auth', () => ({ getSessionPatient: vi.fn() }))

import { eq } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import { patients, smsMessages } from '../../src/db/schema'
import { REDACTED_SMS_BODY, REDACTED_TOKEN_MARKER } from '../../src/lib/sms-redaction'
import { getSessionPatient } from '../../src/routes/patient-auth'
import { patientPortalApp } from '../../src/routes/patient-portal'

const TAG = `feed-${Date.now()}`
const PHONE = '0240000091'

let db: DB
let patientId: string
const app = new Hono<HonoEnv>()
app.route('/api/patient-portal', patientPortalApp)

describe.skipIf(skip)('F01 — the patient reminder feed', () => {
  beforeAll(async () => {
    db = getDb(RAW_DB_URL)
    const [p] = await db
      .insert(patients)
      .values({
        name: `IT Feed ${TAG}`,
        dob: new Date('1990-01-01'),
        gender: 'other',
        phone: PHONE,
      })
      .returning()
    patientId = p.id
    vi.mocked(getSessionPatient).mockResolvedValue({ patient: p } as never)

    await db.insert(smsMessages).values([
      {
        recipient: PHONE,
        patientId,
        type: 'bulk',
        status: 'sent',
        content: REDACTED_SMS_BODY, // a login code, as it is stored now
      },
      {
        recipient: PHONE,
        patientId,
        type: 'appointment',
        status: 'sent',
        content: `Hi, confirm: https://x.test/c/${REDACTED_TOKEN_MARKER} ${TAG}`,
      },
      {
        recipient: PHONE,
        patientId,
        type: 'appointment',
        status: 'sent',
        content: `Your appointment is tomorrow ${TAG}`,
      },
    ])
  })

  afterAll(async () => {
    if (skip || !db) return
    await db.delete(smsMessages).where(eq(smsMessages.recipient, PHONE))
    await db.delete(patients).where(eq(patients.id, patientId))
  })

  it('shows real reminders, including a confirmation with its link cut out', async () => {
    const res = await app.request('/api/patient-portal/reminders')
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: Array<{ body: string }> }
    const bodies = data.map((r) => r.body)

    expect(bodies).toContain(`Your appointment is tomorrow ${TAG}`)
    expect(bodies.some((b) => b.includes('/c/[token redacted]'))).toBe(true)
  })

  it('does not list a stored login code as a reminder', async () => {
    const res = await app.request('/api/patient-portal/reminders')
    const { data } = (await res.json()) as { data: Array<{ body: string }> }

    expect(data.map((r) => r.body)).not.toContain(REDACTED_SMS_BODY)
  })
})
