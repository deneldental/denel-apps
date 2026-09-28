/**
 * migrate.mjs
 *
 * Direct SQL migration runner for backend.
 *
 * Bypasses drizzle-kit CLI and drizzle-orm's internal hash tracking entirely.
 * Uses a simple custom tracking table keyed by migration TAG
 * (e.g. "0001_foamy_taskmaster") so this works correctly whether the database
 * was created via push or migrate.
 *
 * Order of operations:
 *  1. Create a `__applied_migrations` tracking table (tag-based) if needed.
 *  2. For each migration in `meta/_journal.json` order, if its tag isn't
 *     recorded, apply it.
 *  3. Each migration runs inside its OWN transaction. Every statement in the
 *     file must succeed; the tag is recorded as the last statement of that
 *     same transaction. On any error the whole migration rolls back and the
 *     runner aborts — so a migration is never half-applied, and a
 *     never-applied (or aborted) migration is never recorded as done
 *     (code-report-v1 C11).
 *
 * Re-run safety: an already-applied migration is skipped by tag. A migration
 * that errors leaves NO partial state (the transaction rolled back), so it can
 * be re-run after the SQL is fixed. The runner deliberately does NOT swallow
 * "already exists" — that masked non-idempotent migrations and let the runner
 * record a half-applied migration as done. New migrations must therefore be
 * idempotent: `CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and
 * `ADD CONSTRAINT` guarded by a preceding `DROP CONSTRAINT IF EXISTS` or a
 * `pg_constraint` existence check (code-report-v1 H16).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set.')
  process.exit(1)
}

// Strip sslmode from the URL — newer pg versions treat sslmode=require as
// verify-full, which fails against DigitalOcean/Neon self-signed CA certs.
// We handle SSL explicitly via { ssl: { rejectUnauthorized: false } } instead.
const cleanUrl = DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')

// A local Postgres (the opt-in `dev:local` flow) has no TLS, so only force SSL
// for remote hosts. Mirrors getDb()'s isLocalHost handling in src/db/index.ts.
// `FRAMADA_LOCAL_DB=1` (scripts/dev-local.mjs) covers a bare Podman/WSL machine
// IP the regex can't recognise.
const isLocalHost =
  process.env.FRAMADA_LOCAL_DB === '1' ||
  /@(localhost|127\.0\.0\.1|host\.docker\.internal|framada-db-1|db)([:/]|$)/.test(cleanUrl)
let client = new pg.Client({
  connectionString: cleanUrl,
  ssl: isLocalHost ? false : { rejectUnauthorized: false },
})

async function connectWithSslFallback() {
  try {
    await client.connect()
  } catch (err) {
    if (err.message && err.message.includes('The server does not support SSL connections')) {
      console.warn('  ⚠️ Server does not support SSL. Retrying without SSL...')
      client = new pg.Client({ connectionString: cleanUrl, ssl: false })
      await client.connect()
    } else {
      throw err
    }
  }
}

async function main() {
  await connectWithSslFallback()
  console.log('Connected to database.')

  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf-8')
  )
  const entries = journal.entries // [{ idx, tag, ... }]

  // 1. Create tracking table if needed.
  await client.query(`
    CREATE TABLE IF NOT EXISTS "__applied_migrations" (
      tag TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `)

  // 2. Get already-applied tags.
  const { rows } = await client.query(`SELECT tag FROM "__applied_migrations"`)
  const appliedTags = new Set(rows.map((r) => r.tag))

  let appliedCount = 0
  let skippedCount = 0

  for (const entry of entries) {
    const tag = entry.tag // e.g. "0001_foamy_taskmaster"

    if (appliedTags.has(tag)) {
      console.log(`  ⏭  Skipping ${tag} (already applied)`)
      skippedCount++
      continue
    }

    const sqlFile = path.join(MIGRATIONS_DIR, `${tag}.sql`)
    if (!fs.existsSync(sqlFile)) {
      // A journal entry with no SQL file means the migration set is
      // inconsistent — continuing risks applying later migrations on top of a
      // missing one. Fail loudly.
      throw new Error(`SQL file not found for journal tag "${tag}" — migration set is inconsistent`)
    }

    const sql = fs.readFileSync(sqlFile, 'utf-8')

    // Split on `--> statement-breakpoint` when present (drizzle-kit
    // migrations); a file with no breakpoints runs as one multi-statement
    // query. Either way every statement runs inside the SAME transaction
    // below, so the migration is atomic.
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    console.log(`  Applying ${tag} (${statements.length} statement(s))...`)

    // 3. One transaction per migration: all statements + the tag record commit
    //    together, or nothing does.
    await client.query('BEGIN')
    try {
      for (const stmt of statements) {
        await client.query(stmt)
      }
      await client.query(`INSERT INTO "__applied_migrations" (tag) VALUES ($1)`, [tag])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`  ✗ ${tag} failed — rolled back, NOT recorded as applied.`)
      console.error(`    ${err.message}`)
      throw err
    }

    console.log(`  ✓ Applied ${tag}`)
    appliedCount++
  }

  console.log(`\n✓ Done. Applied: ${appliedCount}, Skipped: ${skippedCount}`)
  await client.end()
}

main().catch((err) => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
