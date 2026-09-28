/**
 * dev-list-staff-phones.ts — DEV ONLY.
 *
 * Lists active staff with a linked auth user, their RBAC role, and normalized
 * phone, sorted by role — so you can pick a specific role to test the Team
 * (staff) phone+OTP sign-in. Login resolves the OLDEST active staff for a given
 * phone, so if several staff share a phone only the oldest is reachable; use
 * dev-staff-set-phone.ts to give a specific staffer a unique phone.
 *
 *   cd backend && doppler run -- pnpm tsx src/scripts/dev-list-staff-phones.ts
 */

import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'
import { formatPhoneNumber } from '../lib/utils/phone'

if (process.env.APP_ENV === 'production') {
  console.error('Refusing to run in production.')
  process.exit(1)
}
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
      fullName: schema.staff.fullName,
      staffId: schema.staff.staffId,
      position: schema.staff.position,
      phone: schema.staff.phone,
      roleId: schema.user.roleId,
      createdAt: schema.staff.createdAt,
    })
    .from(schema.staff)
    .innerJoin(schema.user, eq(schema.staff.userId, schema.user.id))
    .where(and(eq(schema.staff.status, 'active'), isNull(schema.staff.deletedAt)))
    .orderBy(schema.user.roleId, schema.staff.createdAt)

  // Which staff wins login for each normalized phone (oldest = first, since
  // rows are ordered by createdAt within role; recompute globally to be safe).
  const oldestByPhone = new Map<string, string>()
  const byCreated = [...rows].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
  for (const r of byCreated) {
    if (!r.phone) continue
    const n = formatPhoneNumber(r.phone)
    if (!oldestByPhone.has(n)) oldestByPhone.set(n, r.staffId ?? '')
  }

  console.log(`\nActive staff with a linked user: ${rows.length}\n`)
  console.log('  ROLE            PHONE (norm)   STAFF ID    NAME                 LOGIN?')
  console.log(`  ${'-'.repeat(76)}`)
  for (const r of rows) {
    const norm = r.phone ? formatPhoneNumber(r.phone) : '(none)'
    const wins = r.phone && oldestByPhone.get(norm) === r.staffId ? '← reachable' : ''
    console.log(
      `  ${(r.roleId ?? '?').padEnd(15)} ${norm.padEnd(14)} ${(r.staffId ?? '').padEnd(11)} ${(r.fullName ?? '').padEnd(20)} ${wins}`
    )
  }
  console.log('')
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
