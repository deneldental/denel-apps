// One-off: apply 0020_patient_cases.sql to the dev database.
// Run with: doppler run -- node run-migration-0020.mjs

import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const __dir = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(__dir, 'migrations', '0020_patient_cases.sql')
const raw = readFileSync(sqlPath, 'utf8')

// Split on Drizzle breakpoints, strip leading comments, skip empty chunks
const statements = raw
  .split('--> statement-breakpoint')
  .map(s => s.replace(/^(\s*--[^\n]*\n)*/m, '').trim()) // strip leading comment lines
  .filter(s => s.length > 0)

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

await client.connect()
console.log('Connected. Applying 0020_patient_cases.sql...\n')

let ok = 0
let skipped = 0
for (const stmt of statements) {
  const preview = stmt.replace(/\s+/g, ' ').slice(0, 70)
  try {
    await client.query(stmt)
    console.log(`  ✓ ${preview}`)
    ok++
  } catch (e) {
    if (e.code === '42P07' || e.code === '42701' || e.code === '42P16') {
      // already exists / duplicate column — safe to skip
      console.log(`  ~ skipped (already exists): ${preview}`)
      skipped++
    } else {
      console.error(`  ✗ FAILED: ${e.message}\n    SQL: ${preview}`)
    }
  }
}

await client.end()
console.log(`\nDone — ${ok} applied, ${skipped} skipped.`)
