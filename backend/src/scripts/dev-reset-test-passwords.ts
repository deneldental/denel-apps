/**
 * dev-reset-test-passwords.ts — DEV ONLY.
 *
 * Resets the Better-Auth (email+password) credential for every
 * `@test.framada.app` test user to a KNOWN password, so you can sign into the
 * HR app (and any email+password surface) during local E2E testing without
 * knowing whatever password the accounts were originally seeded with.
 *
 * Only touches `*@test.framada.app` accounts. Refuses to run in production.
 *
 *   cd backend && node scripts/dev-local.mjs pnpm exec tsx src/scripts/dev-reset-test-passwords.ts
 *   # or against Doppler's DB:  doppler run -- pnpm exec tsx src/scripts/dev-reset-test-passwords.ts
 *
 * Password: TEST_LOGIN_PASSWORD env, else 'TestPass1234'.
 */

import { and, eq, like } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'
import { hashPassword } from '../lib/password'

if (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production') {
  console.error('✖  Refusing to run in production.')
  process.exit(1)
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')

const PASSWORD = process.env.TEST_LOGIN_PASSWORD ?? 'TestPass1234'

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

async function main() {
  console.log('🔑 Resetting @test.framada.app passwords →', JSON.stringify(PASSWORD))
  const users = await db
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .where(like(schema.user.email, '%@test.framada.app'))

  if (users.length === 0) {
    console.log('   (no @test.framada.app users found)')
    return
  }

  const hash = await hashPassword(PASSWORD)
  for (const u of users) {
    const existing = await db
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(and(eq(schema.account.userId, u.id), eq(schema.account.providerId, 'credential')))
      .limit(1)

    if (existing.length > 0) {
      await db
        .update(schema.account)
        .set({ password: hash, updatedAt: new Date() })
        .where(eq(schema.account.id, existing[0].id))
      console.log(`   ↻ ${u.email} password reset`)
    } else {
      await db.insert(schema.account).values({
        id: crypto.randomUUID(),
        accountId: u.id,
        providerId: 'credential',
        userId: u.id,
        password: hash,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      console.log(`   + ${u.email} credential account created`)
    }
  }

  console.log('\n✅ Done. Sign in with any of these + the password above:')
  for (const u of users) console.log(`   ${u.email}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✖  Failed:', err)
    process.exit(1)
  })
