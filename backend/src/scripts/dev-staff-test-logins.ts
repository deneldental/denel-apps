/**
 * dev-staff-test-logins.ts — DEV ONLY.
 *
 * The dev DB's staff share a couple of phones, so phone+OTP login always resolves
 * to the oldest (an admin). This gives a few NON-admin test staff their own unique
 * phone so you can sign in to the Team app as each role and see its layout/home.
 * It only sets phones; get a code per phone with dev-staff-otp.ts (after Continue).
 *
 *   cd backend && doppler run -- pnpm tsx src/scripts/dev-staff-test-logins.ts
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

// role → { unique dev phone to assign, where that role lands after login }
const TARGETS: { roleId: string; phone: string; home: string }[] = [
  { roleId: 'doctor', phone: '0209990001', home: '/doctor/home (DoctorLayout)' },
  { roleId: 'lab_technician', phone: '0209990002', home: '/lab/jobs (LabTechLayout)' },
  { roleId: 'receptionist', phone: '0209990003', home: '/dashboard (StaffLayout, non-admin)' },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool, { schema })

  console.log('')
  for (const t of TARGETS) {
    const [row] = await db
      .select({
        id: schema.staff.id,
        fullName: schema.staff.fullName,
        staffId: schema.staff.staffId,
      })
      .from(schema.staff)
      .innerJoin(schema.user, eq(schema.staff.userId, schema.user.id))
      .where(
        and(
          eq(schema.user.roleId, t.roleId),
          eq(schema.staff.status, 'active'),
          isNull(schema.staff.deletedAt)
        )
      )
      .orderBy(schema.staff.createdAt)
      .limit(1)

    if (!row) {
      console.log(`  [skip] no active ${t.roleId} with a linked user`)
      continue
    }

    const normalized = formatPhoneNumber(t.phone)
    await db.update(schema.staff).set({ phone: normalized }).where(eq(schema.staff.id, row.id))

    console.log(`  ${t.roleId.padEnd(15)} → enter ${t.phone}   (${row.fullName}, ${row.staffId})`)
    console.log(`  ${''.padEnd(15)}   lands on ${t.home}\n`)
  }

  console.log('Next, for each: enter the phone in the Team app → Continue → then run')
  console.log('  doppler run -- pnpm tsx src/scripts/dev-staff-otp.ts <phone>')
  console.log('to mint + print its 6-digit code.\n')

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
