/**
 * backfill-payment-plan-tags.ts
 *
 * Tags old payments with the payment plan they paid (G07). See
 * `lib/payment-plan-tag-backfill.ts` for the rule and the guarantees.
 *
 * A DRY RUN by default: it lists what it would tag and what it leaves alone, and writes nothing.
 * Review that list, then run again with --apply. Safe to re-run.
 *
 *   doppler run -- pnpm tsx src/scripts/backfill-payment-plan-tags.ts                 # report only
 *   doppler run -- pnpm tsx src/scripts/backfill-payment-plan-tags.ts --patient=<uuid> # one patient
 *   doppler run -- pnpm tsx src/scripts/backfill-payment-plan-tags.ts --limit=200      # first 200
 *   doppler run -- pnpm tsx src/scripts/backfill-payment-plan-tags.ts --apply          # write
 *
 * Against the local database: `node scripts/dev-local.mjs tsx src/scripts/backfill-payment-plan-tags.ts`.
 * Against production (the image ships `dist/` only, so this is the bundled copy):
 *   docker compose run --rm backend node dist/scripts/backfill-payment-plan-tags.js          # report only
 *   docker compose run --rm backend node dist/scripts/backfill-payment-plan-tags.js --apply  # write
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { DB } from '../db'
import * as schema from '../db/schema'
import { sslOptionFor } from '../lib/db-ssl'
import { backfillPaymentPlanTags } from '../lib/payment-plan-tag-backfill'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const APPLY = process.argv.includes('--apply')
const limitArg = arg('limit')
const LIMIT = limitArg === undefined ? undefined : Number(limitArg)
const PATIENT_ID = arg('patient')

if (LIMIT !== undefined && (!Number.isInteger(LIMIT) || LIMIT <= 0)) {
  throw new Error('--limit must be a positive whole number')
}
if (PATIENT_ID !== undefined && !/^[0-9a-f-]{36}$/i.test(PATIENT_ID)) {
  throw new Error('--patient must be a patient id (uuid)')
}

const cleanUrl = DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')
const pool = new Pool({ connectionString: cleanUrl, ssl: sslOptionFor(cleanUrl) })
const db = drizzle(pool, { schema }) as unknown as DB

async function main() {
  const host = new URL(cleanUrl).host
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — payment plan tags on ${host}\n`)

  const report = await backfillPaymentPlanTags(db, {
    apply: APPLY,
    limit: LIMIT,
    patientId: PATIENT_ID,
  })

  for (const row of report.rows) {
    const label = row.paymentNumber ?? row.paymentId
    if (row.outcome === 'tag') {
      console.log(
        `${APPLY ? 'tagged ' : 'would tag'}  ${label} (${row.status}) -> plan ${row.planId}`
      )
    } else {
      console.log(
        `left alone  ${label} (${row.status}): pays a plan and something else — not tagged`
      )
    }
  }

  console.log('\n── Summary ──────────────────────────')
  console.log(`Untagged payments looked at:  ${report.scanned}`)
  console.log(
    `Tagged:                       ${report.tagged}${APPLY ? '' : `  (dry run: ${report.wouldTag} would be tagged)`}`
  )
  console.log(`Mixed, left alone:            ${report.mixed}`)
  console.log(`Pay no plan (nothing to do):  ${report.noPlan}`)
  if (!APPLY && report.wouldTag > 0) {
    console.log('\nNothing was written. Review the list above, then run again with --apply.')
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
