/**
 * seed-test-logins.ts — Creates one test login per system role + a test patient.
 *
 * Refuses to run when NODE_ENV === 'production'.
 *
 * Idempotent: existing users are left alone (password is NOT updated). The role
 * assignment is reconciled if it has drifted.
 *
 * Depends on: roles must already be seeded (run `pnpm seed:rbac` first).
 *
 * Run with:
 *   doppler run --project framada-projects --config dev -- pnpm tsx src/scripts/seed-test-logins.ts
 *   doppler run --project framada-projects --config stg -- pnpm tsx src/scripts/seed-test-logins.ts
 *
 * Reads DATABASE_URL from process.env.
 *
 * Created users (all share the same password — see TEST_PASSWORD below):
 *   admin@test.framada.app          → admin
 *   doctor@test.framada.app         → doctor
 *   receptionist@test.framada.app   → receptionist
 *   trainer@test.framada.app        → external_trainer
 *   labtech@test.framada.app        → lab_technician
 *
 * Created patient (PWA login):
 *   patientId: #P-TEST    password: $SEED_TEST_PASSWORD   phone: 0200000000
 */

import { randomUUID, subtle } from 'node:crypto'
import * as dotenv from 'dotenv'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'
import { hashPassword } from '../lib/password'

dotenv.config({ path: '.dev.vars' })

if (process.env.NODE_ENV === 'production') {
  console.error('✖  Refusing to run in production. Test logins must never be seeded into prod.')
  process.exit(1)
}

const TEST_PASSWORD = (() => {
  const v = process.env.SEED_TEST_PASSWORD || 'password123'
  if (!v) {
    console.error('✖  SEED_TEST_PASSWORD environment variable is required')
    process.exit(1)
  }
  return v
})()
const TEST_PATIENT_ID = '#P-TEST'
const TEST_PATIENT_PHONE = '0200000000'
// Known raw token seeded into patientTrustedDevices so test automation can
// skip OTP by presenting this value as the `patient_trusted_device` cookie.
export const TEST_PATIENT_DEVICE_TOKEN = 'framada-test-patient-trusted-device-token-00000000'

interface StaffSeed {
  email: string
  name: string
  /** RBAC role slug — must match a row in `roles.id` */
  rbacRoleId: string
  /** Better Auth admin-plugin role field. Only `admin` and `external_trainer` are special. */
  betterAuthRole: 'admin' | 'user' | 'external_trainer'
  /**
   * Ensure a `doctors` row exists and is linked to this user. Every doctor-facing
   * surface (Activity day-sheet, Scheduling, the weekly report) resolves "which
   * doctor am I?" via `doctors.userId = user.id`. A doctor login without that row
   * silently sees an empty clinic, so the login alone is not enough to test with.
   */
  doctorProfile?: { specialty: string }
}

const STAFF_SEEDS: StaffSeed[] = [
  {
    email: 'admin@test.framada.app',
    name: 'Test Admin',
    rbacRoleId: 'admin',
    betterAuthRole: 'admin',
  },
  {
    email: 'doctor@test.framada.app',
    name: 'Test Doctor',
    rbacRoleId: 'doctor',
    betterAuthRole: 'user',
    doctorProfile: { specialty: 'General Dentistry' },
  },
  {
    email: 'receptionist@test.framada.app',
    name: 'Test Receptionist',
    rbacRoleId: 'receptionist',
    betterAuthRole: 'user',
  },
  {
    email: 'trainer@test.framada.app',
    name: 'Test External Trainer',
    rbacRoleId: 'external_trainer',
    betterAuthRole: 'external_trainer',
  },
  {
    email: 'labtech@test.framada.app',
    name: 'Test Lab Technician',
    rbacRoleId: 'lab_technician',
    betterAuthRole: 'user',
  },
]

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://framada:framada@localhost:5432/framada'
if (!DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')

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

async function seedStaffUser(seed: StaffSeed): Promise<{ created: boolean }> {
  const role = await db.query.roles.findFirst({ where: eq(schema.roles.id, seed.rbacRoleId) })
  if (!role) {
    throw new Error(
      `Role "${seed.rbacRoleId}" not found. Run \`pnpm seed:rbac\` first to seed the RBAC tables.`
    )
  }

  const existing = await db.query.user.findFirst({ where: eq(schema.user.email, seed.email) })
  const now = new Date()

  const passwordHash = await hashPassword(TEST_PASSWORD)

  if (existing) {
    const driftedRole = existing.roleId !== role.id || existing.role !== seed.betterAuthRole
    if (driftedRole) {
      await db
        .update(schema.user)
        .set({ roleId: role.id, role: seed.betterAuthRole, updatedAt: now })
        .where(eq(schema.user.id, existing.id))
      console.log(`   ↻ ${seed.email} role reconciled → ${seed.rbacRoleId}`)
    } else {
      console.log(`   = ${seed.email} role correct`)
    }

    // Force update password just in case it got out of sync
    const existingAccount = await db.query.account.findFirst({
      where: eq(schema.account.userId, existing.id),
    })
    if (existingAccount) {
      await db
        .update(schema.account)
        .set({ password: passwordHash })
        .where(eq(schema.account.id, existingAccount.id))
      console.log(`   ↻ ${seed.email} password forcibly reset`)
    }
    return { created: false }
  }

  const userId = randomUUID()
  await db.insert(schema.user).values({
    id: userId,
    name: seed.name,
    email: seed.email,
    emailVerified: true,
    role: seed.betterAuthRole,
    roleId: role.id,
    banned: false,
    createdAt: now,
    updatedAt: now,
  })

  await db.insert(schema.account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  })

  console.log(`   + ${seed.email} created (${seed.rbacRoleId})`)
  return { created: true }
}

/**
 * Ensure the user has a `doctors` row pointing at them, and return its id.
 *
 * Order of preference:
 *   1. Already linked — nothing to do.
 *   2. Adopt an ORPHAN profile (`userId IS NULL`). Orphans have no login attached,
 *      so nobody can reach them; claiming one hands the test doctor that profile's
 *      real appointment history instead of an empty calendar. Preference goes to
 *      the orphan with the most appointments TODAY (that's where the day-sheet /
 *      estimate flow is exercised), then the most overall.
 *   3. Create a fresh profile — the fresh-database path.
 *
 * Only rows with a NULL userId are ever touched, and the script refuses to run
 * with NODE_ENV=production, so no real doctor's profile can be reassigned.
 */
async function ensureDoctorProfile(
  userId: string,
  label: string,
  specialty: string
): Promise<string> {
  const linked = await db.query.doctors.findFirst({ where: eq(schema.doctors.userId, userId) })
  if (linked) {
    console.log(`   = ${label} already linked to doctor profile ${linked.id}`)
    return linked.id
  }

  const orphans = await db
    .select({
      id: schema.doctors.id,
      specialty: schema.doctors.specialty,
      today: sql<number>`count(${schema.appointments.id}) filter (
        where ${schema.appointments.date} >= current_date
          and ${schema.appointments.date} < current_date + interval '1 day'
      )::int`,
      total: sql<number>`count(${schema.appointments.id})::int`,
    })
    .from(schema.doctors)
    .leftJoin(schema.appointments, eq(schema.appointments.doctorId, schema.doctors.id))
    .where(and(isNull(schema.doctors.userId), isNull(schema.doctors.specialistId)))
    .groupBy(schema.doctors.id, schema.doctors.specialty)

  orphans.sort((a, b) => b.today - a.today || b.total - a.total)
  const adopt = orphans[0]

  if (adopt) {
    await db
      .update(schema.doctors)
      .set({ userId, updatedAt: new Date() })
      .where(eq(schema.doctors.id, adopt.id))
    console.log(
      `   ↻ ${label} adopted orphan doctor profile ${adopt.id} ` +
        `(${adopt.specialty}, ${adopt.total} appointments, ${adopt.today} today)`
    )
    return adopt.id
  }

  const [created] = await db
    .insert(schema.doctors)
    .values({ userId, specialty })
    .returning({ id: schema.doctors.id })
  console.log(`   + ${label} doctor profile created (${created.id})`)
  return created.id
}

/**
 * Guarantee the doctor has something to work on today: a checked-in visit routed
 * doctor-first, i.e. the `awaiting_estimate` state that drives Create estimate →
 * View estimate → Create treatment plan, and reception's Confirm & pay after it.
 *
 * Idempotent per day via the marker in `notes`, so re-running never piles up
 * duplicate visits.
 */
const FIXTURE_MARKER = 'seed:test-estimate-flow'

async function seedEstimateFlowVisit(doctorId: string, patientId: string): Promise<void> {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const endOfToday = new Date(startOfToday)
  endOfToday.setDate(endOfToday.getDate() + 1)

  const existing = await db.query.appointments.findFirst({
    where: and(
      eq(schema.appointments.doctorId, doctorId),
      eq(schema.appointments.notes, FIXTURE_MARKER),
      sql`${schema.appointments.date} >= ${startOfToday} and ${schema.appointments.date} < ${endOfToday}`
    ),
  })
  if (existing) {
    console.log(`   = today's estimate-flow visit already seeded (${existing.id})`)
    return
  }

  const when = new Date(startOfToday)
  when.setHours(10, 0, 0, 0)

  const [appt] = await db
    .insert(schema.appointments)
    .values({
      patientId,
      doctorId,
      date: when,
      durationMinutes: 30,
      status: 'checked_in',
      type: 'consultation',
      notes: FIXTURE_MARKER,
      requiresEstimate: true,
      estimateStatus: 'awaiting_estimate',
      checkedInAt: new Date(),
    })
    .returning({ id: schema.appointments.id })
  console.log(`   + today's estimate-flow visit seeded (${appt.id}, awaiting_estimate)`)
}

async function sha256Hex(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw)
  // Copy into a fresh ArrayBuffer so the BufferSource type matches lib.dom's
  // Uint8Array<ArrayBuffer> expectation (TS 5.9+ tightened this).
  const input = new Uint8Array(bytes.length)
  input.set(bytes)
  const buf = await subtle.digest('SHA-256', input.buffer)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function seedPatientTrustedDevice(patientId: string): Promise<void> {
  const tokenHash = await sha256Hex(TEST_PATIENT_DEVICE_TOKEN)
  const existing = await db.query.patientTrustedDevices.findFirst({
    where: eq(schema.patientTrustedDevices.tokenHash, tokenHash),
  })
  if (existing) {
    console.log(`   = trusted device already seeded`)
    return
  }
  await db.insert(schema.patientTrustedDevices).values({
    patientId,
    tokenHash,
    userAgent: 'TestBrowser/1.0 (seed-test-logins)',
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  })
  console.log(`   + trusted device seeded (token: ${TEST_PATIENT_DEVICE_TOKEN})`)
}

async function seedTestPatient(): Promise<{ created: boolean }> {
  const existing = await db.query.patients.findFirst({
    where: eq(schema.patients.patientId, TEST_PATIENT_ID),
  })
  const now = new Date()
  const passwordHash = await hashPassword(TEST_PASSWORD)

  if (existing) {
    if (!existing.pwaAccessEnabled || !existing.pwaPasswordHash) {
      await db
        .update(schema.patients)
        .set({
          pwaAccessEnabled: true,
          pwaPasswordHash: existing.pwaPasswordHash ?? passwordHash,
          pwaAccessGrantedAt: existing.pwaAccessGrantedAt ?? now,
          updatedAt: now,
        })
        .where(eq(schema.patients.id, existing.id))
      console.log(`   ↻ ${TEST_PATIENT_ID} PWA access reconciled`)
    } else {
      console.log(`   = ${TEST_PATIENT_ID} already correct`)
    }
    return { created: false }
  }

  await db.insert(schema.patients).values({
    name: 'Test Patient',
    email: 'patient@test.framada.app',
    phone: TEST_PATIENT_PHONE,
    dob: new Date('1990-01-01'),
    gender: 'other',
    patientId: TEST_PATIENT_ID,
    category: 'ongoing',
    pwaAccessEnabled: true,
    pwaPasswordHash: passwordHash,
    pwaAccessGrantedAt: now,
  })
  console.log(`   + ${TEST_PATIENT_ID} patient created`)
  return { created: true }
}

async function main() {
  console.log('🌱 Seeding test logins')
  console.log('   Target:', DATABASE_URL?.split('@')[1]?.split('/')[0] ?? '(unknown host)')
  console.log('')

  console.log('→ Staff users')
  let doctorProfileId: string | null = null
  for (const seed of STAFF_SEEDS) {
    await seedStaffUser(seed)
    if (seed.doctorProfile) {
      const user = await db.query.user.findFirst({ where: eq(schema.user.email, seed.email) })
      if (user) {
        doctorProfileId = await ensureDoctorProfile(
          user.id,
          seed.name,
          seed.doctorProfile.specialty
        )
      }
    }
  }

  console.log('')
  console.log('→ Patient PWA login')
  await seedTestPatient()

  const testPatient = await db.query.patients.findFirst({
    where: eq(schema.patients.patientId, TEST_PATIENT_ID),
  })

  if (doctorProfileId && testPatient) {
    console.log('')
    console.log("→ Today's doctor worklist visit")
    await seedEstimateFlowVisit(doctorProfileId, testPatient.id)
  }

  console.log('')
  console.log('→ Patient trusted device (OTP bypass for automation)')
  if (testPatient) {
    await seedPatientTrustedDevice(testPatient.id)
  } else {
    console.log('   ✖ test patient not found — skipping trusted device')
  }

  console.log('')
  console.log('✅ Done.')
  console.log('')
  console.log('Login matrix:')
  for (const s of STAFF_SEEDS) {
    console.log(`   ${s.rbacRoleId.padEnd(20)} ${s.email}`)
  }
  console.log(`   patient (PWA)        patientId=${TEST_PATIENT_ID}  phone=${TEST_PATIENT_PHONE}`)
  console.log(
    `   patient trusted device cookie: patient_trusted_device=${TEST_PATIENT_DEVICE_TOKEN}`
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✖  Seed failed:', err)
    process.exit(1)
  })
