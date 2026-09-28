/**
 * seed-test-pwa-staff.ts — extends seed-test-logins to add a STAFF row per
 * test user (admin / doctor / receptionist / trainer / lab_technician). The
 * staff row is what gives them a staffId (`FDM-T000N`) usable for PWA
 * `signIn.username`, and a phone number so the device-trust OTP step routes
 * to the test SMS stub.
 *
 * Run with:
 *   doppler run --project framada-projects --config dev \
 *     -- pnpm tsx src/scripts/seed-test-pwa-staff.ts
 *
 * Refuses to run in production. Idempotent — reruns leave existing staff
 * rows alone (only fields drifted from desired state are reconciled).
 *
 * Login matrix (after this script + seed-test-logins.ts have both run):
 *
 *   role             email                            staffId      phone           password
 *   ---------------  -------------------------------  -----------  --------------  ------------
 *   admin            admin@test.framada.app           FDM-T0001    +233000000001   TestPass1234
 *   doctor           doctor@test.framada.app          FDM-T0002    +233000000002   TestPass1234
 *   receptionist     receptionist@test.framada.app    FDM-T0003    +233000000003   TestPass1234
 *   external_trainer trainer@test.framada.app         FDM-T0004    +233000000004   TestPass1234
 *   lab_technician   labtech@test.framada.app         FDM-T0005    +233000000005   TestPass1234
 *   patient (PWA)    -                                #P-TEST      0200000000      TestPass1234
 *
 * Every staff row gets its OWN phone number (test stub range). Team sign-in is
 * by phone, and `findActiveStaffByPhone` refuses an ambiguous match, so a shared
 * number would make every seeded row unreachable. Only `receptionist`
 * (FDM-T0003) and `lab_technician` (FDM-T0005) hold the `pwa` interface scope —
 * the other three are useful precisely because they should be turned away.
 *
 * These are the same assignments `team/tests/e2e/global-setup.ts` (STAFF_PHONES)
 * expects; keep the two in step.
 */

import { randomUUID } from 'node:crypto'
import * as dotenv from 'dotenv'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'

dotenv.config({ path: '.dev.vars' })

if (process.env.NODE_ENV === 'production') {
  console.error('✖  Refusing to run in production.')
  process.exit(1)
}

interface PwaStaffSeed {
  email: string
  staffId: string
  rbacRoleId: string
  fullName: string
  /** Distinct per row — Team sign-in resolves a staff member by phone. */
  phone: string
}

const SEEDS: PwaStaffSeed[] = [
  {
    email: 'admin@test.framada.app',
    staffId: 'FDM-T0001',
    phone: '+233000000001',
    rbacRoleId: 'admin',
    fullName: 'Test Admin',
  },
  {
    email: 'doctor@test.framada.app',
    staffId: 'FDM-T0002',
    phone: '+233000000002',
    rbacRoleId: 'doctor',
    fullName: 'Test Doctor',
  },
  {
    email: 'receptionist@test.framada.app',
    staffId: 'FDM-T0003',
    phone: '+233000000003',
    rbacRoleId: 'receptionist',
    fullName: 'Test Receptionist',
  },
  {
    email: 'trainer@test.framada.app',
    staffId: 'FDM-T0004',
    phone: '+233000000004',
    rbacRoleId: 'external_trainer',
    fullName: 'Test Trainer',
  },
  {
    email: 'labtech@test.framada.app',
    staffId: 'FDM-T0005',
    phone: '+233000000005',
    rbacRoleId: 'lab_technician',
    fullName: 'Test Lab Tech',
  },
]

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')

const cleanUrl = DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')

// Local Postgres (dev:local) has no TLS — only force SSL for remote hosts.
const isLocalHost = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(cleanUrl)
const pool = new Pool({
  connectionString: cleanUrl,
  ssl: isLocalHost ? false : { rejectUnauthorized: false },
})
const db = drizzle(pool, { schema })

async function ensureUserPwaFields(userId: string, seed: PwaStaffSeed): Promise<void> {
  // Better Auth username plugin needs user.username (lowercased) for
  // signIn.username to match. Also populate user.phone so the device-trust
  // OTP layer has something to text (the test stub captures it).
  const username = seed.staffId.toLowerCase()
  const updates: Record<string, unknown> = { updatedAt: new Date() }

  const existingUser = await db.query.user.findFirst({
    where: eq(schema.user.id, userId),
  })
  if (!existingUser) return

  if (existingUser.username !== username) updates.username = username
  if (existingUser.displayUsername !== seed.staffId) updates.displayUsername = seed.staffId
  if (existingUser.phone !== seed.phone) updates.phone = seed.phone
  // twoFactorEnabled must be false — Better Auth's twoFactor plugin is no
  // longer loaded, but if a stale `true` lingers from migration 0066 it has
  // no effect today. We zero it anyway to keep state aligned with intent.
  if (existingUser.twoFactorEnabled !== false) updates.twoFactorEnabled = false

  if (Object.keys(updates).length > 1) {
    await db.update(schema.user).set(updates).where(eq(schema.user.id, userId))
    console.log(`   ↻ ${seed.email} user fields reconciled (username + phone)`)
  } else {
    console.log(`   = ${seed.email} user fields already correct`)
  }
}

async function ensureStaffRow(seed: PwaStaffSeed): Promise<void> {
  const userRow = await db.query.user.findFirst({ where: eq(schema.user.email, seed.email) })
  if (!userRow) {
    console.log(`   ⚠ ${seed.email} — no user row. Run seed-test-logins.ts first.`)
    return
  }

  await ensureUserPwaFields(userRow.id, seed)

  const existing = await db.query.staff.findFirst({
    where: eq(schema.staff.staffId, seed.staffId),
  })

  const now = new Date()
  if (existing) {
    // Reconcile any drift in the linkage / phone / first-login flag.
    const updates: Record<string, unknown> = { updatedAt: now }
    if (existing.userId !== userRow.id) updates.userId = userRow.id
    if (existing.phone !== seed.phone) updates.phone = seed.phone
    if (existing.isFirstLogin !== false) updates.isFirstLogin = false
    if (existing.deletedAt !== null) updates.deletedAt = null
    if (Object.keys(updates).length > 1) {
      await db.update(schema.staff).set(updates).where(eq(schema.staff.id, existing.id))
      console.log(`   ↻ ${seed.staffId} staff row reconciled`)
    } else {
      console.log(`   = ${seed.staffId} staff row already correct`)
    }
    return
  }

  await db.insert(schema.staff).values({
    id: randomUUID(),
    staffId: seed.staffId,
    userId: userRow.id,
    fullName: seed.fullName,
    email: seed.email,
    phone: seed.phone,
    employmentType: 'permanent',
    status: 'active',
    isFirstLogin: false,
    staffType: 'internal',
    isExternalTrainer: seed.rbacRoleId === 'external_trainer',
    createdAt: now,
    updatedAt: now,
  })
  console.log(`   + ${seed.staffId} staff row created`)
}

async function main() {
  console.log('🌱 Seeding test PWA staff (staffId + phone for OTP)')
  console.log('   Target:', DATABASE_URL?.split('@')[1]?.split('/')[0] ?? '(unknown host)')
  console.log('')

  for (const seed of SEEDS) {
    await ensureStaffRow(seed)
  }

  console.log('')
  console.log('✅ Done.')
  console.log('')
  console.log('PWA staff sign-in matrix:')
  for (const s of SEEDS) {
    console.log(`   ${s.rbacRoleId.padEnd(20)} staffId=${s.staffId}  phone=${s.phone}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✖  Seed failed:', err)
    process.exit(1)
  })
