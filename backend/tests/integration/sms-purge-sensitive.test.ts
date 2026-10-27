/**
 * F01 / decision D1 — rows already in `sms_messages` from before redaction
 * existed (login/reset/registration codes and confirmation links) are DELETED by
 * a one-off script; the owner chose deletion over redaction on 2026-10-26.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F01, D1).
 *
 * Real database, real rows. The wording below is copied from what the senders
 * actually produce (lib/staff-otp.ts, lib/patient-otp.ts, routes/staff-registration.ts,
 * routes/appointment-workflow.ts), including the old "Framada Dental:" brand
 * prefix, next to lookalikes that must survive.
 *
 * ── Safety ── commits fixtures; local Postgres only; cleans up after itself.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/sms-purge-sensitive.test.ts
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type DB, getDb } from '../../src/db'
import { smsMessages } from '../../src/db/schema'
import { purgeSensitiveSms } from '../../src/lib/sms-purge'
import { REDACTED_SMS_BODY, REDACTED_TOKEN_MARKER } from '../../src/lib/sms-redaction'

const RAW_DB_URL = process.env.DATABASE_URL ?? ''
const IS_LOCAL = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(RAW_DB_URL)
const skip = !IS_LOCAL

const PHONE = '0240000095'

const MUST_GO: Array<[string, string]> = [
  ['staff login code', 'Denel: your staff portal login code is 123456. Valid for 10 minutes.'],
  [
    'password reset code (old brand)',
    "Framada Dental: your password reset code is 654321. Valid for 10 minutes. If you didn't request this, ignore this message.",
  ],
  [
    'patient verification code',
    'Denel: your patient portal verification code is 246810. Valid for 10 minutes.',
  ],
  [
    'staff registration code',
    'Denel: your staff registration code is 135790. Valid for 10 minutes.',
  ],
  [
    'confirmation link',
    'Hi Ama, reminder: appointment at Denel on 1/11/2026 at 09:00 with Dr Owusu. Confirm or cancel: https://app.deneldental.com/c/6b0f2c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f',
  ],
]
const MUST_STAY: Array<[string, string]> = [
  ['ordinary reminder', 'Your appointment is tomorrow at 9am'],
  ['promo wording with "code"', 'Use promo code SAVE2026 at the front desk'],
  ['invoice code', 'Your invoice code is INV-2026-0042, thank you.'],
  ['redacted code stand-in', REDACTED_SMS_BODY],
  [
    'redacted link stand-in',
    `Hi Ama, confirm: https://app.deneldental.com/c/${REDACTED_TOKEN_MARKER}`,
  ],
  [
    'short link without a uuid',
    'Pay your balance: https://app.deneldental.com/c/abc123 reference 20260001',
  ],
]

let db: DB

async function remainingContents() {
  const rows = await db.select().from(smsMessages).where(eq(smsMessages.recipient, PHONE))
  return rows.map((r) => r.content)
}

describe.skipIf(skip)('D1 — purging credential-bearing rows that predate redaction', () => {
  beforeAll(async () => {
    db = getDb(RAW_DB_URL)
    await db.insert(smsMessages).values(
      [...MUST_GO, ...MUST_STAY].map(([, content]) => ({
        recipient: PHONE,
        type: 'bulk',
        status: 'sent',
        content,
      }))
    )
  })

  afterAll(async () => {
    if (skip || !db) return
    await db.delete(smsMessages).where(eq(smsMessages.recipient, PHONE))
  })

  it('a dry run counts the rows and deletes nothing', async () => {
    const before = await remainingContents()
    const result = await purgeSensitiveSms(db, { apply: false })

    // Other rows may exist in the database; this suite's own rows must all be counted.
    expect(result.matched).toBeGreaterThanOrEqual(MUST_GO.length)
    expect(result.deleted).toBe(0)
    expect(await remainingContents()).toEqual(before)
  })

  it('--apply deletes every credential-bearing row and keeps everything else', async () => {
    const result = await purgeSensitiveSms(db, { apply: true })
    expect(result.deleted).toBe(result.matched)

    const left = await remainingContents()
    for (const [label, content] of MUST_GO) {
      expect(left, `"${label}" should be gone`).not.toContain(content)
    }
    for (const [label, content] of MUST_STAY) {
      expect(left, `"${label}" should survive`).toContain(content)
    }
    expect(left).toHaveLength(MUST_STAY.length)
  })

  it('is idempotent: a second run finds nothing', async () => {
    const again = await purgeSensitiveSms(db, { apply: true })
    expect(again).toMatchObject({ matched: 0, deleted: 0 })
  })

  it('returns counts only, never message text', async () => {
    const result = await purgeSensitiveSms(db, { apply: false })
    expect(Object.keys(result).sort()).toEqual(['deleted', 'matched', 'scanned'])
  })
})
