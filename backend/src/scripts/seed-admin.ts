/**
 * seed-admin.ts — Creates a single admin user in the staging/dev database.
 *
 * Idempotent: if a user with the same email already exists, the admin role is
 * (re)assigned and the credential password is re-synced from
 * SEED_ADMIN_PASSWORD, so the seeded login always matches Doppler. Note the
 * consequence: changing this account's password in-app is reverted by the next
 * deploy — use a separate, non-seeded account for day-to-day admin work.
 *
 * Runs on every production deploy as `node dist/scripts/seed-admin.js`
 * (see .github/workflows/deploy.yml), after seed-rbac.
 *
 * Run manually with:
 *   doppler run --project framada-projects --config stg -- pnpm tsx src/scripts/seed-admin.ts
 *
 * Reads DATABASE_URL from process.env.
 */

import { randomUUID } from 'node:crypto'
import * as dotenv from 'dotenv'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'
import { sslOptionFor } from '../lib/db-ssl'
import { hashPassword } from '../lib/password'

dotenv.config({ path: '.dev.vars' })

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@deneldental.com'
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || 'Admin'
// No fallback password. This previously defaulted to 'password123' and then
// checked `if (!ADMIN_PASSWORD)` — a guard that could never fire, so running
// this against a production DATABASE_URL without the var set would silently
// create an admin with a publicly known password. The local flow is
// unaffected: scripts/dev-local.mjs always injects SEED_ADMIN_PASSWORD
// (defaulting to 'password123') before invoking this script.
const ADMIN_PASSWORD: string = process.env.SEED_ADMIN_PASSWORD ?? ''
if (!ADMIN_PASSWORD) {
  console.error('✖  SEED_ADMIN_PASSWORD environment variable is required')
  process.exit(1)
}
const ADMIN_ROLE_NAME = 'admin'

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://framada:framada@localhost:5432/framada'
if (!DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')

const cleanUrl = DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')

// Local Postgres (dev:local, and the VPS's in-network `db` service) has no
// TLS — only force SSL for remote hosts. See lib/db-ssl.ts.
const pool = new Pool({
  connectionString: cleanUrl,
  ssl: sslOptionFor(cleanUrl),
})
const db = drizzle(pool, { schema })

async function main() {
  console.log(`🌱 Seeding admin user: ${ADMIN_EMAIL}\n`)

  const adminRole = await db.query.roles.findFirst({
    where: eq(schema.roles.id, ADMIN_ROLE_NAME),
  })
  if (!adminRole) {
    throw new Error(
      `Admin role not found. Run 'pnpm tsx src/scripts/seed-rbac.ts' first to seed roles.`
    )
  }
  console.log(`✓ Found admin role: ${adminRole.id}`)

  const existing = await db.query.user.findFirst({
    where: eq(schema.user.email, ADMIN_EMAIL),
  })

  const now = new Date()

  if (existing) {
    if (existing.roleId === adminRole.id && existing.role === 'admin') {
      console.log(`✓ User already exists with admin role.`)
    } else {
      await db
        .update(schema.user)
        .set({ roleId: adminRole.id, role: 'admin', updatedAt: now })
        .where(eq(schema.user.id, existing.id))
      console.log(`✓ Existing user ${existing.id} promoted to admin.`)
    }

    // The credential password is re-synced from SEED_ADMIN_PASSWORD on every
    // run, so Doppler is the single source of truth for the seeded admin login
    // and a deploy always leaves that account reachable. Note the consequence:
    // changing this admin's password in-app is reverted by the next deploy.
    // Use a separate (non-seeded) account for day-to-day admin work.
    const existingPasswordHash = await hashPassword(ADMIN_PASSWORD)
    const credential = await db.query.account.findFirst({
      where: and(
        eq(schema.account.userId, existing.id),
        eq(schema.account.providerId, 'credential')
      ),
    })

    if (credential) {
      await db
        .update(schema.account)
        .set({ password: existingPasswordHash, updatedAt: now })
        .where(eq(schema.account.id, credential.id))
      console.log(`✓ Credential password synced from SEED_ADMIN_PASSWORD.`)
    } else {
      await db.insert(schema.account).values({
        id: randomUUID(),
        accountId: existing.id,
        providerId: 'credential',
        userId: existing.id,
        password: existingPasswordHash,
        createdAt: now,
        updatedAt: now,
      })
      console.log(`✓ Credential account created for existing user.`)
    }

    process.exit(0)
  }

  const userId = randomUUID()
  await db.insert(schema.user).values({
    id: userId,
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    emailVerified: true,
    role: 'admin',
    roleId: adminRole.id,
    banned: false,
    createdAt: now,
    updatedAt: now,
  })
  console.log(`✓ User row created (${userId})`)

  const passwordHash = await hashPassword(ADMIN_PASSWORD)
  await db.insert(schema.account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  })
  console.log(`✓ Credential account created`)

  console.log(`\n✅ Admin seeded successfully.`)
  console.log(`   Email: ${ADMIN_EMAIL}`)
  console.log(`   Role:  admin`)

  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Failed to seed admin:', err)
  process.exit(1)
})
