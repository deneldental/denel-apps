/**
 * encrypt-integration-secrets.ts
 *
 * One-shot backfill: encrypt any plaintext rows in `clinic_settings` whose key
 * matches an INTEGRATION_KEYS entry. Rows already in the encrypted-envelope
 * shape ({ v: 1, iv, ct, tag }) are skipped — the script is idempotent and
 * safe to re-run.
 *
 * Encryption uses AES-256-GCM with a key derived from BETTER_AUTH_SECRET (the
 * same trust anchor as the runtime lib/crypto.ts and the existing Google
 * OAuth / Service Account stores). After this script runs, the runtime
 * readKv/writeKv path encrypts on every write and decrypts on every read.
 *
 * Run:
 *   doppler run --config prd -- pnpm tsx backend/scripts/encrypt-integration-secrets.ts
 *   doppler run --config stg -- pnpm tsx backend/scripts/encrypt-integration-secrets.ts
 *
 * Output: per-key status (encrypted | already-encrypted | missing | failed).
 * Exits non-zero only if a row was found but encryption failed.
 */

import { eq } from 'drizzle-orm'
import { validateBackendEnv } from '../src/config/env'
import { getDb } from '../src/db'
import { clinicSettings } from '../src/db/schema'
import { encryptJson, isEncryptedBlob } from '../src/lib/crypto'
import { INTEGRATION_KEYS } from '../src/lib/integrations'

// Validate env first so the crypto helper's BETTER_AUTH_SECRET access works.
validateBackendEnv()

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('✖  DATABASE_URL is not set.')
  process.exit(1)
}

type Outcome = 'encrypted' | 'already-encrypted' | 'missing' | 'failed'

async function main() {
  const db = getDb(DATABASE_URL!)
  const results: Array<{ key: string; outcome: Outcome; error?: string }> = []

  for (const key of Object.values(INTEGRATION_KEYS)) {
    const [row] = await db
      .select()
      .from(clinicSettings)
      .where(eq(clinicSettings.key, key))
      .limit(1)

    if (!row) {
      results.push({ key, outcome: 'missing' })
      continue
    }

    if (isEncryptedBlob(row.value)) {
      results.push({ key, outcome: 'already-encrypted' })
      continue
    }

    try {
      const blob = encryptJson(row.value)
      await db
        .update(clinicSettings)
        .set({ value: blob, updatedAt: new Date() })
        .where(eq(clinicSettings.key, key))
      results.push({ key, outcome: 'encrypted' })
    } catch (err) {
      results.push({
        key,
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  console.log('\nBackfill summary:')
  for (const r of results) {
    const tag =
      r.outcome === 'encrypted'
        ? '✓ encrypted        '
        : r.outcome === 'already-encrypted'
          ? '· already-encrypted'
          : r.outcome === 'missing'
            ? '– missing          '
            : '✖ failed           '
    console.log(`  ${tag}  ${r.key}${r.error ? ` — ${r.error}` : ''}`)
  }

  const failed = results.filter((r) => r.outcome === 'failed')
  if (failed.length > 0) process.exit(1)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
