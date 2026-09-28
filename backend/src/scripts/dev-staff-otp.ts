/**
 * dev-staff-otp.ts — DEV ONLY.
 *
 * Set a known staff login OTP so you can test the passwordless phone+OTP sign-in
 * in a browser without SMS delivery (Hubtel doesn't deliver to handsets in dev).
 * Resolves the same staff `/api/staff-auth/login` would (oldest active match for
 * the phone) and overwrites their pending `login_phone` OTP with a printed code.
 *
 * Run it AFTER you click "Continue" on the phone step (so it supersedes the OTP
 * that step just created):
 *   cd backend && doppler run -- pnpm tsx src/scripts/dev-staff-otp.ts 0553424972
 */

import { createHash } from 'node:crypto'
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
const rawPhone = process.argv[2]
if (!rawPhone) {
  console.error('Usage: dev-staff-otp.ts <phone>   e.g. dev-staff-otp.ts 0553424972')
  process.exit(1)
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool, { schema })

  const phone = formatPhoneNumber(rawPhone)
  const rows = await db
    .select({
      id: schema.staff.id,
      fullName: schema.staff.fullName,
      phone: schema.staff.phone,
      userId: schema.staff.userId,
    })
    .from(schema.staff)
    .where(and(eq(schema.staff.status, 'active'), isNull(schema.staff.deletedAt)))
    .orderBy(schema.staff.createdAt)

  const match = rows.find((r) => r.userId && formatPhoneNumber(r.phone) === phone)
  if (!match) {
    console.error(`No active staff (with a linked user) found for phone ${phone}`)
    await pool.end()
    process.exit(1)
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const codeHash = createHash('sha256').update(code).digest('hex')

  await db
    .delete(schema.staffOtpCodes)
    .where(
      and(
        eq(schema.staffOtpCodes.staffId, match.id),
        eq(schema.staffOtpCodes.purpose, 'login_phone')
      )
    )
  await db.insert(schema.staffOtpCodes).values({
    staffId: match.id,
    codeHash,
    phone,
    purpose: 'login_phone',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  })

  console.log(`\n  Staff:  ${match.fullName}`)
  console.log(`  Phone:  ${phone}`)
  console.log(`  >>> Login code: ${code}   (valid 10 minutes)\n`)

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
