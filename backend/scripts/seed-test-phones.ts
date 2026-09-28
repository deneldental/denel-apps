/**
 * seed-test-phones.ts
 *
 * Rewrites every contact phone in the source-of-truth entity tables to a
 * single test number so SMS smoke tests fire against the operator's phone
 * instead of real patients/staff.
 *
 * DESTRUCTIVE: overwrites real phone numbers. Refuses to touch production by
 * default. Defaults to dry-run.
 *
 * Touches (entity tables — source of truth):
 *   - patients.phone, patients.guardianPhone, patients.emergencyContactPhone
 *   - staff.phone, staff.emergencyContactPhone
 *   - user.phone
 *   - specialists.contactPhone
 *   - suppliers.contactPhone
 *   - compliance_documents.reminderPhones  (JSONB array → [TEST_PHONE])
 *
 * Skips (operational logs — never overwrite):
 *   - sms_messages.recipient        (outgoing SMS log)
 *   - staff_otp_codes.phone         (per-issuance log)
 *   - websiteBookings.phone         (lead capture, not an entity)
 *
 * Usage:
 *   # Dry-run (default) — shows what would change, makes no writes
 *   doppler run --config stg -- pnpm tsx backend/scripts/seed-test-phones.ts
 *
 *   # Apply against staging/dev
 *   doppler run --config stg -- pnpm tsx backend/scripts/seed-test-phones.ts --apply
 *
 *   # Override the production safety check (do not use)
 *   doppler run --config prd -- pnpm tsx backend/scripts/seed-test-phones.ts --apply --force-production
 */

import { sql } from 'drizzle-orm'
import { getDb } from '../src/db'

const TEST_PHONE = '0553424972'

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const FORCE_PROD = args.has('--force-production')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('✖  DATABASE_URL is not set.')
  process.exit(1)
}

// ── Production safety check ─────────────────────────────────────────────────
const appEnv = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'unknown'
const urlLooksProd =
  /digitalocean|ondigitalocean|db\.do\b/i.test(DATABASE_URL) ||
  /-prd\.|-prod\./i.test(DATABASE_URL)

const looksProd = appEnv === 'production' || urlLooksProd

if (looksProd && !FORCE_PROD) {
  console.error('✖  Refusing to run against what looks like PRODUCTION.')
  console.error(`   APP_ENV/NODE_ENV: ${appEnv}`)
  console.error(`   DATABASE_URL hint: ${urlLooksProd ? 'matches prod pattern' : 'env-flagged'}`)
  console.error('')
  console.error('   This script overwrites every contact phone in the DB.')
  console.error('   If you really meant to run against production, re-run with')
  console.error('   --apply --force-production (and brace yourself).')
  process.exit(1)
}

if (looksProd && FORCE_PROD) {
  console.warn('⚠  --force-production is set. This will rewrite every phone in PRODUCTION.')
  console.warn(`⚠  Target test phone: ${TEST_PHONE}`)
  console.warn('⚠  No turning back — patient records will be overwritten.')
}

// ── Execute ────────────────────────────────────────────────────────────────
async function main() {
  const db = getDb(DATABASE_URL!)

  console.log(`\nMode: ${APPLY ? 'APPLY (will write)' : 'DRY-RUN (no writes)'}`)
  console.log(`Target test phone: ${TEST_PHONE}`)
  console.log(`Env: ${appEnv}\n`)

  // Each entry: a human label + a single SQL statement. Count queries are
  // separate so dry-run can report the blast radius without mutating anything.
  const targets: Array<{
    label: string
    count: ReturnType<typeof sql>
    apply: ReturnType<typeof sql>
  }> = [
    {
      label: 'patients.phone',
      count: sql`SELECT count(*)::int AS n FROM patients WHERE phone IS DISTINCT FROM ${TEST_PHONE}`,
      apply: sql`UPDATE patients SET phone = ${TEST_PHONE} WHERE phone IS DISTINCT FROM ${TEST_PHONE}`,
    },
    {
      label: 'patients.guardianPhone',
      count: sql`SELECT count(*)::int AS n FROM patients WHERE "guardianPhone" IS DISTINCT FROM ${TEST_PHONE}`,
      apply: sql`UPDATE patients SET "guardianPhone" = ${TEST_PHONE} WHERE "guardianPhone" IS DISTINCT FROM ${TEST_PHONE}`,
    },
    {
      label: 'patients.emergencyContactPhone',
      count: sql`SELECT count(*)::int AS n FROM patients WHERE "emergencyContactPhone" IS DISTINCT FROM ${TEST_PHONE}`,
      apply: sql`UPDATE patients SET "emergencyContactPhone" = ${TEST_PHONE} WHERE "emergencyContactPhone" IS DISTINCT FROM ${TEST_PHONE}`,
    },
    {
      label: 'staff.phone',
      count: sql`SELECT count(*)::int AS n FROM staff WHERE phone IS DISTINCT FROM ${TEST_PHONE}`,
      apply: sql`UPDATE staff SET phone = ${TEST_PHONE} WHERE phone IS DISTINCT FROM ${TEST_PHONE}`,
    },
    {
      label: 'staff.emergencyContactPhone',
      count: sql`SELECT count(*)::int AS n FROM staff WHERE "emergencyContactPhone" IS DISTINCT FROM ${TEST_PHONE}`,
      apply: sql`UPDATE staff SET "emergencyContactPhone" = ${TEST_PHONE} WHERE "emergencyContactPhone" IS DISTINCT FROM ${TEST_PHONE}`,
    },
    {
      label: 'user.phone',
      count: sql`SELECT count(*)::int AS n FROM "user" WHERE phone IS DISTINCT FROM ${TEST_PHONE}`,
      apply: sql`UPDATE "user" SET phone = ${TEST_PHONE} WHERE phone IS DISTINCT FROM ${TEST_PHONE}`,
    },
    {
      label: 'specialists.contact_phone',
      count: sql`SELECT count(*)::int AS n FROM specialists WHERE contact_phone IS DISTINCT FROM ${TEST_PHONE}`,
      apply: sql`UPDATE specialists SET contact_phone = ${TEST_PHONE} WHERE contact_phone IS DISTINCT FROM ${TEST_PHONE}`,
    },
    {
      label: 'suppliers.contactPhone',
      count: sql`SELECT count(*)::int AS n FROM suppliers WHERE "contactPhone" IS DISTINCT FROM ${TEST_PHONE}`,
      apply: sql`UPDATE suppliers SET "contactPhone" = ${TEST_PHONE} WHERE "contactPhone" IS DISTINCT FROM ${TEST_PHONE}`,
    },
    {
      // jsonb array → [TEST_PHONE]. Compares as text to keep the predicate simple.
      label: 'compliance_documents.reminderPhones',
      count: sql`SELECT count(*)::int AS n FROM compliance_documents WHERE "reminderPhones"::text IS DISTINCT FROM ${JSON.stringify([TEST_PHONE])}`,
      apply: sql`UPDATE compliance_documents SET "reminderPhones" = ${JSON.stringify([TEST_PHONE])}::jsonb WHERE "reminderPhones"::text IS DISTINCT FROM ${JSON.stringify([TEST_PHONE])}`,
    },
  ]

  let totalChanged = 0
  for (const t of targets) {
    try {
      const countRes = await db.execute(t.count)
      const n = Number((countRes as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0)

      if (APPLY && n > 0) {
        await db.execute(t.apply)
      }

      const tag = APPLY ? (n > 0 ? '✓ updated' : '· unchanged') : '… would update'
      console.log(`  ${tag.padEnd(15)} ${String(n).padStart(6)}   ${t.label}`)
      totalChanged += n
    } catch (err) {
      console.error(
        `  ✖ failed       ${String('?').padStart(6)}   ${t.label} — ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }

  console.log(`\nTotal rows ${APPLY ? 'changed' : 'that would change'}: ${totalChanged}`)
  if (!APPLY) {
    console.log('\n(no writes were performed — re-run with --apply to commit)')
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
