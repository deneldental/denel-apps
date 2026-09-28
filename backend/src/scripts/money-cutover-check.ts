/**
 * money-cutover-check.ts — prove 0209 converted this data correctly.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * `money-unit-check` tells you what unit the COLUMNS are in. It cannot tell you
 * whether the VALUES came through the conversion intact — a column can be
 * `integer` and still hold a number that was multiplied twice, or not at all.
 * The only way to know is to look at the same rows before and after.
 *
 * So: snapshot a sample before migrating, verify it after. Every captured value
 * must satisfy `after === round(before * 100)`, exactly. Anything else is a
 * double conversion, a missed conversion, or a row that changed underneath the
 * migration — all three are things you want to find on a restored copy, not on
 * production three days later.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *   # 1. against the restored copy, BEFORE running migrate.mjs
 *   DATABASE_URL=<copy> pnpm --filter backend money:snapshot -- --out=pre.json
 *
 *   # 2. run the migration
 *   DATABASE_URL=<copy> node migrate.mjs
 *
 *   # 3. same database, AFTER
 *   DATABASE_URL=<copy> pnpm --filter backend money:verify -- --in=pre.json
 *
 * In the production image both modes are on the bundled entry:
 *   node dist/scripts/money-cutover-check.js snapshot --out=/tmp/pre.json
 *   node dist/scripts/money-cutover-check.js verify   --in=/tmp/pre.json
 *
 * READ ONLY in both modes. It never writes to the database.
 *
 * See project-docs/money-unit-audit-and-remediation.md.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as dotenv from 'dotenv'
import { Client } from 'pg'

dotenv.config({ path: '.dev.vars' })
dotenv.config()

const MIGRATION = '0209_dinero_migration'
/** Rows sampled per table. Enough to catch a systematic error; small enough to eyeball. */
const SAMPLE_PER_TABLE = 25

type Cell = { table: string; pk: string; id: string; column: string; value: string | null }
type Snapshot = { takenAt: string; database: string; cells: Cell[] }

function migrationsDir(): string {
  // `import.meta.url` is ESM-only and undefined in tsup's CJS output.
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')
  } catch {
    return join(__dirname, '..', '..', 'migrations')
  }
}

/** The (table, column) pairs 0209 converts, read from the migration itself. */
function targets(): Map<string, string[]> {
  const sql = readFileSync(join(migrationsDir(), `${MIGRATION}.sql`), 'utf-8')
  const byTable = new Map<string, string[]>()
  const re = /\(\s*'([a-z0-9_]+)'\s*,\s*'([A-Za-z0-9_]+)'\s*\)/g
  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec loop
  while ((m = re.exec(sql)) !== null) {
    const cols = byTable.get(m[1]) ?? []
    cols.push(m[2])
    byTable.set(m[1], cols)
  }
  return byTable
}

/** Single-column primary key for a table, or null (composite/none — skipped). */
async function primaryKey(client: Client, table: string): Promise<string | null> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = to_regclass($1) AND i.indisprimary`,
    [`public."${table}"`]
  )
  return rows.length === 1 ? rows[0].column_name : null
}

async function columnsPresent(client: Client, table: string, wanted: string[]): Promise<string[]> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name = ANY($2)`,
    [table, wanted]
  )
  return rows.map((r) => r.column_name)
}

async function connect(): Promise<Client> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('ERROR: DATABASE_URL is not set.')
    process.exit(1)
  }
  const clean = url.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '')
  const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal|framada-db-1|db)([:/]|$)/.test(
    clean
  )
  const client = new Client({
    connectionString: clean,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  })
  await client.connect()
  return client
}

async function snapshot(outPath: string) {
  const client = await connect()
  try {
    const cells: Cell[] = []
    let skipped = 0
    for (const [table, wanted] of targets()) {
      const pk = await primaryKey(client, table)
      if (!pk) {
        skipped++
        continue
      }
      const cols = await columnsPresent(client, table, wanted)
      if (cols.length === 0) continue
      const select = cols.map((c) => `"${c}"::text AS "${c}"`).join(', ')
      const { rows } = await client.query<Record<string, string | null>>(
        `SELECT "${pk}"::text AS __id, ${select} FROM "${table}" ORDER BY "${pk}" LIMIT ${SAMPLE_PER_TABLE}`
      )
      for (const row of rows) {
        for (const c of cols) {
          cells.push({ table, pk, id: row.__id as string, column: c, value: row[c] })
        }
      }
    }
    const snap: Snapshot = {
      takenAt: new Date().toISOString(),
      database: new URL(process.env.DATABASE_URL as string).host,
      cells,
    }
    writeFileSync(outPath, JSON.stringify(snap, null, 2))
    const tables = new Set(cells.map((c) => c.table)).size
    console.log(`Snapshot written to ${outPath}`)
    console.log(`  ${cells.length} values across ${tables} table(s)`)
    console.log(`  ${skipped} table(s) skipped (no single-column primary key)`)
    if (cells.length === 0) {
      console.log('')
      console.log('  NOTE: no money rows found. On an empty database this check proves')
      console.log('  nothing — rehearse against a restored copy that has real data.')
    }
  } finally {
    await client.end()
  }
}

/** Exact ×100 on a decimal string, without going through a float. */
function timesOneHundred(value: string): string {
  const neg = value.startsWith('-')
  const bare = neg ? value.slice(1) : value
  const [int, frac = ''] = bare.split('.')
  const padded = (frac + '00').slice(0, 2)
  const shifted = `${int}${padded}`.replace(/^0+(?=\d)/, '')
  return (neg && shifted !== '0' ? '-' : '') + shifted
}

async function verify(inPath: string) {
  const snap: Snapshot = JSON.parse(readFileSync(inPath, 'utf-8'))
  const client = await connect()
  try {
    let checked = 0
    let nulls = 0
    const mismatches: Array<{ where: string; before: string; expected: string; actual: string }> =
      []
    const missing: string[] = []

    for (const cell of snap.cells) {
      if (cell.value === null) {
        nulls++
        continue
      }
      const { rows } = await client.query<{ v: string | null }>(
        `SELECT "${cell.column}"::text AS v FROM "${cell.table}" WHERE "${cell.pk}"::text = $1`,
        [cell.id]
      )
      if (rows.length === 0) {
        missing.push(`${cell.table}.${cell.id}`)
        continue
      }
      checked++
      const expected = timesOneHundred(cell.value)
      const actual = rows[0].v ?? 'NULL'
      if (actual !== expected) {
        mismatches.push({
          where: `${cell.table}.${cell.column} [${cell.id.slice(0, 8)}]`,
          before: cell.value,
          expected,
          actual,
        })
      }
    }

    console.log('Cutover verification')
    console.log(`  snapshot   ${snap.takenAt} (${snap.database})`)
    console.log(`  compared   ${checked} value(s), ${nulls} null(s) skipped`)
    if (missing.length) console.log(`  missing    ${missing.length} row(s) no longer present`)
    console.log('')

    if (mismatches.length === 0 && checked > 0) {
      console.log('  ✓ PASS — every sampled value is exactly its pre-migration value × 100.')
      return
    }
    if (checked === 0) {
      console.log('  ⚠ NOTHING COMPARED — the snapshot held no non-null values.')
      process.exitCode = 1
      return
    }

    console.log(`  ✗ FAIL — ${mismatches.length} value(s) did not convert cleanly:`)
    console.log('')
    for (const m of mismatches.slice(0, 20)) {
      const ratio = Number(m.actual) / Number(m.before)
      const hint =
        ratio === 1
          ? 'NOT converted'
          : ratio === 10000
            ? 'converted TWICE'
            : `ratio ${ratio.toFixed(4)}`
      console.log(`    ${m.where}`)
      console.log(`      before ${m.before}  expected ${m.expected}  actual ${m.actual}  (${hint})`)
    }
    if (mismatches.length > 20) console.log(`    … and ${mismatches.length - 20} more`)
    console.log('')
    console.log('  Do not promote this migration. Restore and investigate.')
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

function argValue(flag: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1)
}

async function main() {
  const mode = process.argv.find((a) => a === 'snapshot' || a === 'verify')
  if (mode === 'snapshot') return snapshot(argValue('--out') ?? 'money-pre.json')
  if (mode === 'verify') return verify(argValue('--in') ?? 'money-pre.json')
  console.error('Usage: money-cutover-check.js <snapshot --out=file | verify --in=file>')
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
