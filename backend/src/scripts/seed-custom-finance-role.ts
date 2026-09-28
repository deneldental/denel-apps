/**
 * seed-custom-finance-role.ts — Creates a custom (non-system) "Finance Manager"
 * role with full finance access, plus a test login for it.
 *
 * Why: the system-role test logins (seed-test-logins.ts) only cover `admin`
 * (which BYPASSES all permission checks) and the payments-only roles. To
 * smoke-test the full finance module surface under REAL permission evaluation,
 * we need a non-admin role that actually holds the finance bundles.
 *
 * Refuses to run when NODE_ENV === 'production'.
 * Idempotent: re-running reconciles the role/scope/bundle wiring; an existing
 * user's password is left untouched.
 *
 * Depends on: `pnpm seed:rbac` must have run first (needs the finance bundles).
 *
 * Run with:
 *   doppler run --project framada-projects --config dev -- pnpm tsx src/scripts/seed-custom-finance-role.ts
 *
 * Creates:
 *   role:  custom_finance  ("Finance Manager", isSystem=false, scope=portal)
 *          bundles: bundle_financial_full, bundle_accounting_admin,
 *                   bundle_tax_calculations, bundle_dashboard
 *   login: finance@test.framada.app  (password set via SEED_TEST_PASSWORD env var)
 */

import { randomUUID } from 'node:crypto'
import * as dotenv from 'dotenv'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'
import { hashPassword } from '../lib/password'

dotenv.config({ path: '.dev.vars' })

if (process.env.NODE_ENV === 'production') {
  console.error(
    '✖  Refusing to run in production. Custom test roles must never be seeded into prod.'
  )
  process.exit(1)
}

const ROLE_ID = 'custom_finance'
const ROLE_NAME = 'Finance Manager'
const ROLE_DESC =
  'Custom test role — full finance module access exercised under real permission checks.'
const ROLE_SCOPE = 'portal'
const ROLE_BUNDLES = [
  'bundle_financial_full',
  'bundle_accounting_admin',
  'bundle_tax_calculations',
  'bundle_dashboard',
]

const TEST_EMAIL = 'finance@test.framada.app'
const TEST_NAME = 'Test Finance Manager'
const TEST_PASSWORD = (() => {
  const v = process.env.SEED_TEST_PASSWORD
  if (!v) {
    console.error('✖  SEED_TEST_PASSWORD environment variable is required')
    process.exit(1)
  }
  return v
})()

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')

// Strip sslmode — newer pg treats sslmode=require as verify-full, which fails
// against DigitalOcean/Neon self-signed CA certs.
const cleanUrl = DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')

const pool = new Pool({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } })
const db = drizzle(pool, { schema })

async function main() {
  console.log('🌱 Seeding custom Finance Manager role + login')
  console.log('   Target:', DATABASE_URL?.split('@')[1]?.split('/')[0] ?? '(unknown host)')
  console.log('')

  // ── 1. Verify required bundles exist (seed:rbac must have run) ──────────────
  for (const bundleId of ROLE_BUNDLES) {
    const bundle = await db.query.permissionBundles.findFirst({
      where: eq(schema.permissionBundles.id, bundleId),
    })
    if (!bundle) {
      throw new Error(
        `Bundle "${bundleId}" not found. Run \`pnpm seed:rbac\` first to seed the RBAC tables.`
      )
    }
  }

  const now = new Date()

  // ── 2. Upsert the custom role ──────────────────────────────────────────────
  const existingRole = await db.query.roles.findFirst({ where: eq(schema.roles.id, ROLE_ID) })
  if (!existingRole) {
    await db.insert(schema.roles).values({
      id: ROLE_ID,
      name: ROLE_NAME,
      description: ROLE_DESC,
      isSystem: false,
    })
    console.log(`   + role "${ROLE_ID}" created`)
  } else {
    await db
      .update(schema.roles)
      .set({ name: ROLE_NAME, description: ROLE_DESC, isSystem: false, updatedAt: now })
      .where(eq(schema.roles.id, ROLE_ID))
    console.log(`   = role "${ROLE_ID}" already exists — reconciled`)
  }

  // ── 3. Reconcile role scope ────────────────────────────────────────────────
  await db.delete(schema.roleScopes).where(eq(schema.roleScopes.roleId, ROLE_ID))
  await db.insert(schema.roleScopes).values({ roleId: ROLE_ID, interfaceScope: ROLE_SCOPE })

  // ── 4. Reconcile role bundles ──────────────────────────────────────────────
  await db.delete(schema.roleBundles).where(eq(schema.roleBundles.roleId, ROLE_ID))
  await db
    .insert(schema.roleBundles)
    .values(ROLE_BUNDLES.map((bundleId) => ({ roleId: ROLE_ID, bundleId })))
  console.log(`   ✓ scope=${ROLE_SCOPE}, bundles=[${ROLE_BUNDLES.join(', ')}]`)

  // ── 5. Upsert the test login ───────────────────────────────────────────────
  const existingUser = await db.query.user.findFirst({ where: eq(schema.user.email, TEST_EMAIL) })
  if (existingUser) {
    if (existingUser.roleId !== ROLE_ID || existingUser.role !== 'user') {
      await db
        .update(schema.user)
        .set({ roleId: ROLE_ID, role: 'user', updatedAt: now })
        .where(eq(schema.user.id, existingUser.id))
      console.log(`   ↻ ${TEST_EMAIL} role reconciled → ${ROLE_ID}`)
    } else {
      console.log(`   = ${TEST_EMAIL} already correct`)
    }
  } else {
    const userId = randomUUID()
    await db.insert(schema.user).values({
      id: userId,
      name: TEST_NAME,
      email: TEST_EMAIL,
      emailVerified: true,
      role: 'user',
      roleId: ROLE_ID,
      banned: false,
      createdAt: now,
      updatedAt: now,
    })
    const passwordHash = await hashPassword(TEST_PASSWORD)
    await db.insert(schema.account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    })
    console.log(`   + ${TEST_EMAIL} created`)
  }

  console.log('')
  console.log('✅ Done.')
  console.log(`   login: ${TEST_EMAIL}  (role: ${ROLE_ID})`)
  await pool.end()
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✖  Seed failed:', err)
    process.exit(1)
  })
