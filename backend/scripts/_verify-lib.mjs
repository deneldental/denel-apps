// _verify-lib.mjs — shared harness for the verify-phase*.mjs invariant scripts.
//
// Replaces the ~30 lines of pg-client boilerplate + the `check()` helper that
// were copy-pasted byte-for-byte across all 8 scripts (audit finding L9), and
// adds a SKIP outcome so count-based invariants no longer pass *vacuously* on
// an empty DB (audit finding H3).
//
// A check fn returns one of:
//   true                       → PASS
//   false                      → FAIL
//   { skip: true, reason? }     → SKIP  (not counted as a failure)
//
// Use `skipIfEmpty(client, table)` at the top of any invariant that is only
// meaningful once rows exist — e.g. "no unbalanced journal entries" is
// trivially true with zero journal entries and must not report PASS there.

import pg from 'pg'

/** Build a pg client from DATABASE_URL, stripping sslmode the way the app does. */
export function makeClient() {
  const u = process.env.DATABASE_URL
  if (!u) throw new Error('DATABASE_URL missing')
  const cleanUrl = u
    .replace(/([?&])sslmode=[^&]*/g, '$1')
    .replace(/[?&]$/, '')
    .replace(/\?&/, '?')
  return new pg.Client({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } })
}

/**
 * Returns `{ skip, reason }` if `table` has zero rows, else `null`.
 * Call at the top of an invariant check and `return` the result if truthy.
 */
export async function skipIfEmpty(client, table, reason) {
  const r = await client.query(`SELECT count(*)::int AS n FROM "${table}"`)
  if (r.rows[0].n === 0) {
    return { skip: true, reason: reason ?? `${table} is empty — invariant is vacuous` }
  }
  return null
}

/**
 * Run an ordered list of `{ label, fn }` checks against a connected client.
 * Prints `PASS` / `FAIL` / `SKIP` per line. Returns true iff there were no FAILs
 * (SKIPs do not fail the run). Prints a one-line summary at the end.
 */
export async function runChecks(client, checks) {
  let pass = 0
  let fail = 0
  let skip = 0

  for (const { label, fn } of checks) {
    try {
      const result = await fn(client)
      if (result && typeof result === 'object' && result.skip) {
        skip++
        console.log(`SKIP  ${label}${result.reason ? `  (${result.reason})` : ''}`)
      } else if (result === true) {
        pass++
        console.log(`PASS  ${label}`)
      } else {
        fail++
        console.log(`FAIL  ${label}`)
      }
    } catch (err) {
      fail++
      console.log(`FAIL  ${label}  (${err.message})`)
    }
  }

  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`)
  return fail === 0
}

/**
 * Standard entry point: connect, run the checks, disconnect, exit non-zero on
 * any FAIL. SKIPs never fail the process.
 *
 *   import { verify, skipIfEmpty } from './_verify-lib.mjs'
 *   await verify([{ label: '...', fn: async (client) => true }])
 */
export async function verify(checks) {
  const client = makeClient()
  await client.connect()
  let ok
  try {
    ok = await runChecks(client, checks)
  } finally {
    await client.end()
  }
  process.exit(ok ? 0 : 1)
}
