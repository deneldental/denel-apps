/**
 * money-unit-check.ts — what unit is this database's money in?
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * Migration 0209 multiplies every money column by 100 (cedis -> pesewas, which
 * the code calls cents). That is correct exactly once. The danger is a window
 * where the deployed CODE already writes pesewas while the COLUMNS are still
 * cedis: rows written in that window are already converted, and 0209 converts
 * them a second time, leaving them 100x too large.
 *
 * Staging hit exactly that window. The cents-aware backend deployed at
 * 2026-09-06T19:16Z, but 0209 failed on `payments_amount_split_check` and did
 * not land until 2026-09-06T23:12Z — so anything written in between was
 * double-converted. This script is how you find out whether a given database is
 * in that state BEFORE running or trusting a conversion.
 *
 * ─── What it reports ─────────────────────────────────────────────────────────
 *   CEDIS      no money column converted yet, 0209 not applied.
 *   PESEWAS    every money column converted, 0209 applied. The steady state.
 *   PARTIAL    some columns converted and some not — a half-applied conversion.
 *              Investigate before doing anything else.
 *   AT RISK    columns are still cedis. If the deployed code is cents-aware,
 *              every row written from now until 0209 runs will be
 *              double-converted. Sequence the deploy: migrate FIRST.
 *
 * With `--since=<ISO>` it also counts rows created after that instant in the
 * tables that carry a timestamp, which is how you size a double-conversion
 * window after the fact.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *   doppler run -- pnpm --filter backend money:units
 *   doppler run -- pnpm --filter backend money:units -- --since=2026-09-06T19:16:00Z
 *   node dist/scripts/money-unit-check.js            # in the production image
 *
 * READ ONLY. It runs SELECTs against information_schema and COUNT(*) queries.
 * It never writes, and it never issues DDL. Deciding what to do about a bad
 * verdict is a human call — see project-docs/money-unit-audit-and-remediation.md.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as dotenv from 'dotenv'
import { Client } from 'pg'

dotenv.config({ path: '.dev.vars' })
dotenv.config()

type Target = { table: string; column: string }
type Observed = Target & { dataType: string | null }

const MIGRATION = '0209_dinero_migration'

/**
 * The (table, column) list is read from the migration itself rather than copied
 * here. A second copy would drift, and a drifted copy of a money-column list is
 * how this class of bug started.
 */
function migrationsDir(): string {
  // `import.meta.url` is ESM-only: tsup emits CJS, where it is `undefined` at
  // runtime and `fileURLToPath` throws. The bundled build has `__dirname`
  // instead. Both layouts put the SQL two levels up — `src/scripts/..` and
  // `dist/scripts/..` are each one hop from `migrations/`.
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')
  } catch {
    return join(__dirname, '..', '..', 'migrations')
  }
}

function targetsFromMigration(): Target[] {
  const sql = readFileSync(join(migrationsDir(), `${MIGRATION}.sql`), 'utf-8')
  const targets: Target[] = []
  const re = /\(\s*'([a-z0-9_]+)'\s*,\s*'([A-Za-z0-9_]+)'\s*\)/g
  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec loop
  while ((m = re.exec(sql)) !== null) {
    targets.push({ table: m[1], column: m[2] })
  }
  return targets
}

async function observe(client: Client, targets: Target[]): Promise<Observed[]> {
  const { rows } = await client.query<{
    table_name: string
    column_name: string
    data_type: string
  }>(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'`
  )
  const byKey = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r.data_type]))
  return targets.map((t) => ({ ...t, dataType: byKey.get(`${t.table}.${t.column}`) ?? null }))
}

async function isMigrationApplied(client: Client): Promise<boolean | null> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='__applied_migrations') AS exists`
  )
  if (!rows[0]?.exists) return null
  const { rows: applied } = await client.query(
    'SELECT 1 FROM __applied_migrations WHERE tag = $1',
    [MIGRATION]
  )
  return applied.length > 0
}

/** Rows created at or after `since`, for the money tables that carry a timestamp. */
async function countRowsSince(
  client: Client,
  tables: string[],
  since: string
): Promise<Array<{ table: string; rows: number }>> {
  const out: Array<{ table: string; rows: number }> = []
  for (const table of tables) {
    const { rows: cols } = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 AND column_name IN ('createdAt','created_at')`,
      [table]
    )
    const stamp = cols[0]?.column_name
    if (!stamp) continue
    const { rows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM "${table}" WHERE "${stamp}" >= $1`,
      [since]
    )
    const n = Number(rows[0]?.n ?? 0)
    if (n > 0) out.push({ table, rows: n })
  }
  return out
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('ERROR: DATABASE_URL is not set.')
    process.exit(1)
  }
  const since = process.argv.find((a) => a.startsWith('--since='))?.slice('--since='.length)
  const json = process.argv.includes('--json')

  const clean = url.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '')
  const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal|framada-db-1|db)([:/]|$)/.test(
    clean
  )
  const client = new Client({
    connectionString: clean,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    const targets = targetsFromMigration()
    const observed = await observe(client, targets)
    const applied = await isMigrationApplied(client)

    const present = observed.filter((o) => o.dataType !== null)
    const converted = present.filter((o) => o.dataType === 'integer')
    const pending = present.filter((o) => o.dataType !== 'integer')
    const absent = observed.filter((o) => o.dataType === null)

    let verdict: 'PESEWAS' | 'CEDIS' | 'PARTIAL' | 'AT RISK'
    if (present.length > 0 && pending.length === 0) verdict = 'PESEWAS'
    else if (converted.length > 0 && pending.length > 0) verdict = 'PARTIAL'
    else verdict = applied === true ? 'PARTIAL' : 'AT RISK'
    if (verdict === 'AT RISK' && converted.length === 0 && applied === false) {
      // Columns are all cedis and the migration has not run. That is a coherent
      // pre-migration state; it is only "at risk" once cents-aware code deploys.
      verdict = 'CEDIS'
    }

    const windowRows = since
      ? await countRowsSince(client, [...new Set(pending.map((p) => p.table))], since)
      : []

    if (json) {
      console.log(
        JSON.stringify(
          { verdict, applied, converted: converted.length, pending: pending.length, windowRows },
          null,
          2
        )
      )
      return
    }

    console.log('Money unit check')
    console.log(`  database         ${new URL(clean).host}`)
    console.log(
      `  ${MIGRATION}   ${applied === null ? 'unknown (no __applied_migrations table)' : applied ? 'applied' : 'NOT applied'}`
    )
    console.log(`  money columns    ${present.length} present, ${absent.length} absent`)
    console.log(`    integer (pesewas) ${converted.length}`)
    console.log(`    numeric (cedis)   ${pending.length}`)
    console.log('')

    if (pending.length > 0 && pending.length <= 20) {
      console.log('  Not yet converted:')
      for (const p of pending) console.log(`    ${p.table}.${p.column}  ${p.dataType}`)
      console.log('')
    }

    console.log(`  VERDICT: ${verdict}`)
    switch (verdict) {
      case 'PESEWAS':
        console.log('  Every money column is integer pesewas. Steady state — do not re-run 0209.')
        break
      case 'CEDIS':
        console.log('  Pre-migration and coherent. Run 0209 BEFORE cents-aware code serves')
        console.log('  traffic, or rows written in between are double-converted.')
        break
      case 'PARTIAL':
        console.log('  Some columns converted and some not. Do not run anything else until')
        console.log('  this is understood — a half-applied conversion is not a safe base.')
        break
      case 'AT RISK':
        console.log('  Columns are still cedis while the migration is recorded, or the state is')
        console.log('  otherwise inconsistent. Investigate before converting.')
        break
    }

    if (since) {
      console.log('')
      console.log(`  Rows created since ${since} in not-yet-converted tables:`)
      if (windowRows.length === 0) {
        console.log('    none — no double-conversion exposure in that window.')
      } else {
        for (const w of windowRows) console.log(`    ${w.table}  ${w.rows}`)
        console.log('')
        console.log('    If cents-aware code wrote these, 0209 will convert them a SECOND')
        console.log('    time. Size the window before migrating, not after.')
      }
    }
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
