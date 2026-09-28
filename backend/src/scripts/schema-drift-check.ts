/**
 * schema-drift-check.ts
 *
 * Diffs the Drizzle schema (`src/db/schema/*.ts`) against the live database's
 * `information_schema.columns`, and fails the process when the schema declares
 * something the database does not have.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * `lab_services.clinicPrice` was declared in `schema/operations.ts` and recorded
 * in the drizzle meta snapshots, but no migration ever emitted the DDL. Because
 * the snapshot already claimed the column, `drizzle-kit generate` considered it
 * applied and never emitted it again — so every environment ran without the
 * column while the ORM kept selecting it. The result was a permanent `500` on
 * `GET /api/labs/service-catalog` (`column ….clinicPrice does not exist`) that
 * reached production undetected. Migration `0195_lab_services_clinic_price.sql`
 * repairs that instance; this script catches the next one.
 *
 * Snapshot-based tooling cannot detect this class of bug — the snapshot is the
 * thing that lied. The only trustworthy source is the database itself, so this
 * compares the schema code against `information_schema` directly and never
 * consults `migrations/meta`.
 *
 * ─── What it reports ─────────────────────────────────────────────────────────
 *   MISSING   declared in the schema, absent from the database  → FATAL (exit 1)
 *             This is the outage class: the ORM will emit SQL referencing a
 *             column or table that does not exist.
 *   EXTRA     present in the database, not declared in the schema → informational
 *             Usually harmless (a retired column nobody dropped), but it is
 *             also how a half-reverted migration looks, so it is always listed.
 *
 * Undeclared tables (better-auth's own tables, `__applied_migrations`, leftovers
 * from removed features) are listed once by name rather than exploded into a
 * per-column EXTRA list, to keep the signal readable.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *   doppler run -- pnpm --filter backend db:drift          # against the config's DB
 *   doppler run -- pnpm --filter backend db:drift -- --strict   # EXTRA also fails
 *   doppler run -- pnpm --filter backend db:drift -- --json     # machine-readable
 *
 * In PRODUCTION the image ships `dist/` only — no `src/`, no `tsx` — so run the
 * bundled entry instead (built by tsup as a second entry point):
 *
 *   docker compose run --rm backend node dist/scripts/schema-drift-check.js
 *
 * That path reads the schema barrel rather than walking `src/db/schema/*.ts`;
 * see `loadSchemaModules()`. Both modes declare the same 227 tables today.
 *
 * Reads `DATABASE_URL`. It only ever runs `SELECT`s against `information_schema`
 * — it never writes, and never issues DDL.
 */

import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as dotenv from 'dotenv'
import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { Client } from 'pg'
// Statically imported so the bundled production build still has the schema
// with no `src/` on disk. See `loadSchemaModules()` for when this is used.
import * as schemaBarrel from '../db/schema'
import { isLocalHostUrl as isLocalHost } from '../lib/db-ssl'

dotenv.config({ path: '.dev.vars' })
dotenv.config()

/**
 * Where the per-file schema sources live, or `null` in the bundled CJS build.
 *
 * `import.meta.url` is an ESM-only construct: tsup emits CJS, where it is
 * `undefined` at runtime and `fileURLToPath` throws. Resolving it eagerly would
 * kill the process at module load — before the bundled-mode fallback in
 * `loadSchemaModules()` ever gets a chance to run — so the failure is caught
 * here and reported as "no source directory", which is exactly what it means.
 */
const SCHEMA_DIR: string | null = (() => {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema')
  } catch {
    return null
  }
})()
const DEFAULT_PG_SCHEMA = 'public'

const argv = process.argv.slice(2)
const STRICT = argv.includes('--strict')
const AS_JSON = argv.includes('--json')

type DeclaredColumn = {
  name: string
  sqlType: string
  notNull: boolean
  hasDefault: boolean
}

type DeclaredTable = {
  key: string
  schema: string
  name: string
  /** Schema source files that declare a table with this name (>1 means a duplicate export). */
  sources: string[]
  columns: Map<string, DeclaredColumn>
}

// ─── 1. Read the declared schema ──────────────────────────────────────────────
// Every `src/db/schema/*.ts` file is imported directly rather than going through
// the `index.ts` barrel, so a table that exists but was never re-exported is
// still checked. Imports are pure table/relation definitions — no side effects.

/**
 * The schema modules to diff, as `[source, module]` pairs.
 *
 * SOURCE mode (dev / CI): one entry per `src/db/schema/*.ts`, so a table that
 * exists but was never re-exported from the barrel is still checked and the
 * report can name the declaring file. This is the stronger check and stays the
 * default whenever the directory is readable.
 *
 * BUNDLED mode (production image): the deploy image ships `dist/` only — no
 * `src/`, no `tsx` — so the per-file walk cannot run. Falls back to the single
 * statically imported barrel, which tsup inlines. A table missing from the
 * barrel is invisible in this mode; that is why SOURCE mode remains the CI gate.
 * BUNDLED mode exists so production can be swept for drift at all (D3).
 *
 * An unreadable schema directory is a mode signal, not a failure.
 */
async function loadSchemaModules(): Promise<Array<[string, Record<string, unknown>]>> {
  let files: string[]
  try {
    if (SCHEMA_DIR === null) throw new Error('bundled build — no schema source directory')
    files = readdirSync(SCHEMA_DIR)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && f !== 'index.ts')
      .sort()
  } catch {
    console.log('  (bundled build — reading the schema barrel; no per-file attribution)')
    return [['(bundled)', schemaBarrel as unknown as Record<string, unknown>]]
  }

  const mods: Array<[string, Record<string, unknown>]> = []
  for (const file of files) {
    mods.push([file, await import(pathToFileURL(join(SCHEMA_DIR as string, file)).href)])
  }
  return mods
}

async function loadDeclaredTables(): Promise<Map<string, DeclaredTable>> {
  const declared = new Map<string, DeclaredTable>()

  for (const [file, mod] of await loadSchemaModules()) {
    for (const value of Object.values(mod)) {
      if (!is(value, PgTable)) continue

      const cfg = getTableConfig(value)
      const schema = cfg.schema ?? DEFAULT_PG_SCHEMA
      const key = `${schema}.${cfg.name}`

      const existing = declared.get(key)
      if (existing) {
        // Same table object re-exported from two files, or two genuinely
        // different declarations that collide on name. Record the source so the
        // report can flag it; the column set is taken from the first sighting.
        if (!existing.sources.includes(file)) existing.sources.push(file)
        continue
      }

      const columns = new Map<string, DeclaredColumn>()
      for (const col of cfg.columns) {
        columns.set(col.name, {
          name: col.name,
          sqlType: col.getSQLType(),
          notNull: col.notNull,
          hasDefault: col.hasDefault,
        })
      }

      declared.set(key, { key, schema, name: cfg.name, sources: [file], columns })
    }
  }

  return declared
}

// ─── 2. Read the live database ────────────────────────────────────────────────

function normalizeConnectionString(url: string): string {
  // Mirrors migrate.mjs: newer `pg` treats `sslmode=require` as verify-full,
  // which fails against Neon/DigitalOcean's self-signed CA chain. SSL is set
  // explicitly below instead.
  return url
    .replace(/([?&])sslmode=[^&]*/g, '$1')
    .replace(/[?&]$/, '')
    .replace(/\?&/, '?')
}

type LiveColumn = { dataType: string; isNullable: boolean }

async function loadLiveSchema(client: Client, schemas: string[]) {
  const tables = new Set<string>()
  const columns = new Map<string, Map<string, LiveColumn>>()

  const { rows: tableRows } = await client.query<{ table_schema: string; table_name: string }>(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_schema = ANY($1::text[])
        AND table_type IN ('BASE TABLE', 'VIEW')`,
    [schemas]
  )
  for (const r of tableRows) tables.add(`${r.table_schema}.${r.table_name}`)

  const { rows: colRows } = await client.query<{
    table_schema: string
    table_name: string
    column_name: string
    data_type: string
    is_nullable: string
  }>(
    `SELECT table_schema, table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = ANY($1::text[])`,
    [schemas]
  )
  for (const r of colRows) {
    const key = `${r.table_schema}.${r.table_name}`
    let bucket = columns.get(key)
    if (!bucket) {
      bucket = new Map<string, LiveColumn>()
      columns.set(key, bucket)
    }
    bucket.set(r.column_name, { dataType: r.data_type, isNullable: r.is_nullable === 'YES' })
  }

  return { tables, columns }
}

// ─── 3. Diff and report ───────────────────────────────────────────────────────

type TableDrift = {
  table: string
  missingTable: boolean
  missingColumns: DeclaredColumn[]
  extraColumns: Array<{ name: string } & LiveColumn>
}

async function main() {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    console.error('ERROR: DATABASE_URL is not set. Run via `doppler run -- …`.')
    process.exit(2)
  }

  const declared = await loadDeclaredTables()
  const schemas = [...new Set([...declared.values()].map((t) => t.schema))]
  if (!schemas.includes(DEFAULT_PG_SCHEMA)) schemas.push(DEFAULT_PG_SCHEMA)

  const url = normalizeConnectionString(raw)
  const client = new Client({
    connectionString: url,
    ssl: isLocalHost(url) ? false : { rejectUnauthorized: false },
  })
  await client.connect()

  let live: Awaited<ReturnType<typeof loadLiveSchema>>
  try {
    live = await loadLiveSchema(client, schemas)
  } finally {
    await client.end()
  }

  const drifts: TableDrift[] = []
  const duplicates: Array<{ table: string; sources: string[] }> = []

  for (const table of [...declared.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    if (table.sources.length > 1) {
      duplicates.push({ table: table.key, sources: table.sources })
    }

    const liveColumns = live.columns.get(table.key)
    const tableExists = live.tables.has(table.key)

    if (!tableExists) {
      drifts.push({
        table: table.key,
        missingTable: true,
        missingColumns: [...table.columns.values()],
        extraColumns: [],
      })
      continue
    }

    const missingColumns = [...table.columns.values()].filter((c) => !liveColumns?.has(c.name))
    const extraColumns = [...(liveColumns?.entries() ?? [])]
      .filter(([name]) => !table.columns.has(name))
      .map(([name, meta]) => ({ name, ...meta }))

    if (missingColumns.length > 0 || extraColumns.length > 0) {
      drifts.push({ table: table.key, missingTable: false, missingColumns, extraColumns })
    }
  }

  // Infrastructure tables that are correctly absent from the Drizzle schema.
  // `__applied_migrations` is migrate.mjs's own ledger — reporting it every run
  // trains readers to ignore this section, which is where a genuinely unexpected
  // table would appear.
  const INFRA_TABLES = new Set(['__applied_migrations'])

  // Tables the database has but the schema never declares. Listed by name only.
  const undeclaredTables = [...live.tables]
    .filter((t) => !declared.has(t) && !INFRA_TABLES.has(t.replace(/^public\./, '')))
    .sort()

  const missingTableCount = drifts.filter((d) => d.missingTable).length
  const missingColumnCount = drifts
    .filter((d) => !d.missingTable)
    .reduce((n, d) => n + d.missingColumns.length, 0)
  const extraColumnCount = drifts.reduce((n, d) => n + d.extraColumns.length, 0)
  const fatal = missingTableCount > 0 || missingColumnCount > 0
  const exitCode = fatal || (STRICT && extraColumnCount > 0) ? 1 : 0

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          declaredTables: declared.size,
          liveTables: live.tables.size,
          missingTableCount,
          missingColumnCount,
          extraColumnCount,
          drifts,
          duplicates,
          undeclaredTables,
          ok: exitCode === 0,
        },
        null,
        2
      )
    )
    process.exit(exitCode)
  }

  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return '(unparseable host)'
    }
  })()

  console.log('Schema ↔ database drift check')
  console.log(`  database        ${host}`)
  console.log(`  declared tables ${declared.size}`)
  console.log(`  live tables     ${live.tables.size}`)
  console.log('')

  if (drifts.length === 0) {
    console.log('✓ No drift. Every declared table and column exists in the database.')
  }

  for (const d of drifts) {
    if (d.missingTable) {
      console.log(`✗ ${d.table}`)
      console.log(
        `    MISSING TABLE — declared with ${d.missingColumns.length} column(s), not in the database`
      )
      console.log('')
      continue
    }

    console.log(`${d.missingColumns.length > 0 ? '✗' : '·'} ${d.table}`)
    for (const c of d.missingColumns) {
      const nullability = c.notNull ? 'NOT NULL' : 'NULL'
      console.log(
        `    MISSING  ${c.name} — declared ${c.sqlType} ${nullability}${
          c.hasDefault ? ' DEFAULT' : ''
        }, not in the database`
      )
    }
    for (const c of d.extraColumns) {
      console.log(
        `    EXTRA    ${c.name} — in the database (${c.dataType}, ${
          c.isNullable ? 'nullable' : 'not null'
        }), not declared in the schema`
      )
    }
    console.log('')
  }

  if (duplicates.length > 0) {
    console.log('Tables declared in more than one schema file:')
    for (const d of duplicates) console.log(`  ${d.table} — ${d.sources.join(', ')}`)
    console.log('')
  }

  if (undeclaredTables.length > 0) {
    console.log(`Tables in the database with no schema declaration (${undeclaredTables.length}):`)
    console.log(`  ${undeclaredTables.join(', ')}`)
    console.log('')
  }

  console.log('Summary')
  console.log(`  missing tables   ${missingTableCount}`)
  console.log(`  missing columns  ${missingColumnCount}`)
  console.log(`  extra columns    ${extraColumnCount}${STRICT ? ' (fatal: --strict)' : ''}`)
  console.log('')

  if (fatal) {
    console.log(
      '✗ FAIL — the schema declares tables/columns the database does not have. The ORM will'
    )
    console.log('  emit SQL referencing them and those queries will 500 at runtime. Write a')
    console.log('  migration (`ADD COLUMN IF NOT EXISTS`) and apply it with `node migrate.mjs`.')
  } else if (STRICT && extraColumnCount > 0) {
    console.log('✗ FAIL (--strict) — the database has columns the schema does not declare.')
  } else if (extraColumnCount > 0) {
    console.log('✓ PASS — no missing tables or columns. Extra database columns listed above are')
    console.log('  informational; they do not break the ORM.')
  }

  process.exit(exitCode)
}

main().catch((err) => {
  console.error('Drift check failed:', err instanceof Error ? err.message : err)
  process.exit(2)
})
