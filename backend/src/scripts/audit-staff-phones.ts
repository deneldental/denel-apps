/**
 * audit-staff-phones.ts
 *
 * Phase 0/4 readiness check for staff passwordless (phone + OTP) login.
 *
 * Phone is the login identifier, so every active staffer needs a UNIQUE phone
 * on file, and the stored value should be normalized (e.g. `233…`). This script
 * is read-only — it reports what HR must fix before the hard uniqueness index
 * (`project-docs/staff-phone-otp-auth-plan.md` §4) can be applied:
 *
 *   1. Active staff with NO phone or NO linked auth user → cannot sign in.
 *   2. Normalized-duplicate phone groups → would collapse to one OTP login.
 *   3. Phones not in canonical form → should be normalized during backfill.
 *
 * Run with:
 *   cd backend && doppler run -- pnpm tsx src/scripts/audit-staff-phones.ts
 */

import { isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'
import { formatPhoneNumber } from '../lib/utils/phone'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool, { schema })

  const rows = await db
    .select({
      id: schema.staff.id,
      staffId: schema.staff.staffId,
      fullName: schema.staff.fullName,
      phone: schema.staff.phone,
      status: schema.staff.status,
      userId: schema.staff.userId,
    })
    .from(schema.staff)
    .where(isNull(schema.staff.deletedAt))

  const active = rows.filter((r) => r.status === 'active')

  // 1. Login-blocked: active staff missing a phone or a linked user.
  const noPhone = active.filter((r) => !r.phone || r.phone.trim() === '')
  const noUser = active.filter((r) => !r.userId)

  // 2. Normalized-duplicate phones among active staff.
  const byNorm = new Map<string, typeof active>()
  for (const r of active) {
    if (!r.phone) continue
    const norm = formatPhoneNumber(r.phone)
    if (!norm) continue
    const arr = byNorm.get(norm) ?? []
    arr.push(r)
    byNorm.set(norm, arr)
  }
  const dupGroups = [...byNorm.entries()].filter(([, arr]) => arr.length > 1)

  // 3. Phones whose stored value differs from the normalized form.
  const unnormalized = active.filter(
    (r) => r.phone && r.phone.trim() !== '' && r.phone !== formatPhoneNumber(r.phone)
  )

  console.log('\n=== Staff phone audit ===')
  console.log(`Active staff (non-deleted): ${active.length}`)

  console.log(`\n[1] Active staff with NO phone (cannot sign in): ${noPhone.length}`)
  for (const r of noPhone) console.log(`    - ${r.staffId}  ${r.fullName}`)

  console.log(`\n[1b] Active staff with NO linked auth user (cannot sign in): ${noUser.length}`)
  for (const r of noUser) console.log(`    - ${r.staffId}  ${r.fullName}`)

  console.log(`\n[2] Duplicate phone groups (must resolve before uniqueness): ${dupGroups.length}`)
  for (const [norm, arr] of dupGroups) {
    console.log(`    ${norm} → ${arr.length} staff:`)
    for (const r of arr) console.log(`        - ${r.staffId}  ${r.fullName}  (raw: ${r.phone})`)
  }

  console.log(
    `\n[3] Phones not in normalized form (backfill should rewrite): ${unnormalized.length}`
  )
  for (const r of unnormalized)
    console.log(`    - ${r.staffId}  ${r.fullName}  ${r.phone} → ${formatPhoneNumber(r.phone)}`)

  const ready = noPhone.length === 0 && noUser.length === 0 && dupGroups.length === 0
  console.log(
    `\n=== Verdict: ${ready ? 'READY' : 'NOT READY'} for the staff.phone uniqueness index ===`
  )
  if (!ready) {
    console.log('Resolve the items above (HR backfill), then re-run this audit.')
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
