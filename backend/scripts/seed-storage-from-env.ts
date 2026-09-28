/**
 * seed-storage-from-env.ts
 *
 * One-shot migration from env-var-driven DO Spaces config to DB-driven
 * integration config. Run BEFORE deploying the storage-consolidation PR so
 * existing prod uploads keep working through the transition.
 *
 * Behavior:
 *   - If `integration_do_spaces` already exists in `clinic_settings`, leaves it
 *     alone (idempotent).
 *   - Otherwise, if all required `DO_SPACES_*` env vars are present, writes
 *     them into the KV row.
 *   - If env vars are missing AND no DB row exists, prints a clear message and
 *     exits non-zero — the admin must configure DO Spaces in the UI.
 *
 * Run:
 *   doppler run --config prd -- pnpm tsx backend/scripts/seed-storage-from-env.ts
 *   doppler run --config stg -- pnpm tsx backend/scripts/seed-storage-from-env.ts
 */

import { eq } from 'drizzle-orm'
import { getDb } from '../src/db'
import { clinicSettings } from '../src/db/schema'
import type { DoSpacesConfig } from '../src/lib/integrations'
import { INTEGRATION_KEYS } from '../src/lib/integrations'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('✖  DATABASE_URL is not set.')
  console.error('   Run via: doppler run --config <env> -- pnpm tsx backend/scripts/seed-storage-from-env.ts')
  process.exit(1)
}

async function main() {
  const db = getDb(DATABASE_URL!)

  const [existing] = await db
    .select()
    .from(clinicSettings)
    .where(eq(clinicSettings.key, INTEGRATION_KEYS.DO_SPACES))
    .limit(1)

  if (existing) {
    console.log(`✓  ${INTEGRATION_KEYS.DO_SPACES} already exists — nothing to do.`)
    process.exit(0)
  }

  const region = process.env.DO_SPACES_REGION
  const endpoint = process.env.DO_SPACES_ENDPOINT
  const bucket = process.env.DO_SPACES_BUCKET
  const accessKeyId = process.env.DO_SPACES_KEY
  const secretAccessKey = process.env.DO_SPACES_SECRET
  const publicUrl = process.env.DO_SPACES_PUBLIC_URL ?? ''

  const missing: string[] = []
  if (!region) missing.push('DO_SPACES_REGION')
  if (!endpoint) missing.push('DO_SPACES_ENDPOINT')
  if (!bucket) missing.push('DO_SPACES_BUCKET')
  if (!accessKeyId) missing.push('DO_SPACES_KEY')
  if (!secretAccessKey) missing.push('DO_SPACES_SECRET')

  if (missing.length > 0) {
    console.error('✖  No existing DO Spaces config in DB and required env vars are missing:')
    for (const v of missing) console.error(`   - ${v}`)
    console.error('   Configure DO Spaces in the admin Integrations UI before uploads will work.')
    process.exit(2)
  }

  const userIdEnv = process.env.SEED_ADMIN_USER_ID
  if (!userIdEnv) {
    console.error('✖  SEED_ADMIN_USER_ID is not set.')
    console.error('   Set it to a valid admin user UUID so the audit trail (updated_by_id)')
    console.error('   has a real owner. Find one with:')
    console.error('     SELECT id FROM "user" WHERE role = \'admin\' LIMIT 1;')
    process.exit(3)
  }

  const value: DoSpacesConfig = {
    region: region!,
    endpoint: endpoint!,
    bucket: bucket!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    publicUrl,
  }

  await db.insert(clinicSettings).values({
    key: INTEGRATION_KEYS.DO_SPACES,
    value,
    updatedById: userIdEnv,
  })

  console.log(`✓  Seeded ${INTEGRATION_KEYS.DO_SPACES} from env vars.`)
  console.log('   Endpoint:', endpoint)
  console.log('   Bucket  :', bucket)
  console.log('   Region  :', region)
  console.log('')
  console.log('Next steps:')
  console.log('  1. Verify in the admin Integrations UI that DO Spaces shows configured.')
  console.log('  2. Click "Test connection" to confirm.')
  console.log('  3. After deploy, env vars become inert — remove them from Doppler.')
  process.exit(0)
}

main().catch((err) => {
  console.error('✖  Seed failed:', err)
  process.exit(1)
})
