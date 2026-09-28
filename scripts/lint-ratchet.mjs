#!/usr/bin/env node
/**
 * Lint ratchet — the warning backlog may shrink, never grow.
 *
 * Why this exists: `pnpm lint` passes on errors only, and the repo carries
 * ~2,250 Biome warnings. A new warning therefore arrives as number 2,251 and is
 * invisible in review — which is how two unused imports and a formatting error
 * reached `main` unnoticed, and how the lint signal stopped meaning anything.
 *
 * Clearing 2,250 warnings is not the job. Stopping the number from rising is.
 * This compares each workspace's warning count against a committed baseline and
 * fails when one increases, so new problems are visible while the backlog is
 * paid down at whatever pace suits.
 *
 * Usage:
 *   node scripts/lint-ratchet.mjs            # check (CI)
 *   node scripts/lint-ratchet.mjs --update   # re-baseline after a reduction
 *
 * When a count drops, --update tightens the ratchet so it can never drift back.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = join(ROOT, 'lint-baseline.json')

/** Workspaces with their own lintable source. `packages/*` are type-only. */
const WORKSPACES = ['backend', 'portals', 'hr', 'team', 'patient', 'reports']

const UPDATE = process.argv.includes('--update')
// Run Biome's Node entry point with this process's own `node`. Going through
// `pnpm exec`, or the `.bin` shim, needs a shell on Windows (`.CMD` cannot be
// spawned directly), and Node deprecates `shell: true` when args are passed.
// This works the same on every platform and resolves the one root biome.json.
const BIOME_ENTRY = join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome')

/** Warning count for one workspace, via Biome's own summary line. */
function countWarnings(workspace) {
  const cwd = join(ROOT, workspace)
  if (!existsSync(cwd)) return null

  let output = ''
  try {
    output = execFileSync(process.execPath, [BIOME_ENTRY, 'check', cwd], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    // Biome exits non-zero when it finds errors. That is `pnpm lint`'s job to
    // report, not this script's — we still want the warning count from stdout.
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`
  }

  const match = /Found (\d+) warnings?/.exec(output)
  if (!match) {
    // No summary line means Biome did not run to completion. Treat that as a
    // failure rather than silently scoring the workspace as zero.
    throw new Error(
      `${workspace}: could not read a warning count from Biome. Output:\n${output.slice(-600)}`
    )
  }
  return Number.parseInt(match[1], 10)
}

const counts = {}
for (const ws of WORKSPACES) {
  const n = countWarnings(ws)
  if (n !== null) counts[ws] = n
}

if (UPDATE) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, 2)}\n`)
  console.log('Baseline updated:')
  for (const [ws, n] of Object.entries(counts)) console.log(`  ${ws.padEnd(9)} ${n}`)
  process.exit(0)
}

if (!existsSync(BASELINE_PATH)) {
  console.error('No lint-baseline.json. Create one with: node scripts/lint-ratchet.mjs --update')
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const regressions = []
const improvements = []

for (const [ws, n] of Object.entries(counts)) {
  const before = baseline[ws]
  if (before === undefined) {
    regressions.push(`${ws}: not in the baseline (${n} warnings) — run --update`)
    continue
  }
  if (n > before) regressions.push(`${ws}: ${before} → ${n}  (+${n - before})`)
  else if (n < before) improvements.push(`${ws}: ${before} → ${n}  (-${before - n})`)
}

for (const [ws, n] of Object.entries(counts)) {
  const before = baseline[ws] ?? '—'
  console.log(`  ${ws.padEnd(9)} ${String(n).padStart(5)}  (baseline ${before})`)
}

if (improvements.length) {
  console.log('\nWarnings reduced:')
  for (const line of improvements) console.log(`  ${line}`)
  console.log('\nRun `node scripts/lint-ratchet.mjs --update` to lock the gain in.')
}

if (regressions.length) {
  console.error('\nLint ratchet failed — new warnings were introduced:\n')
  for (const line of regressions) console.error(`  ${line}`)
  console.error(
    '\nFix the new warnings, or if they are genuinely intended, re-baseline\n' +
      'deliberately with: node scripts/lint-ratchet.mjs --update\n'
  )
  process.exit(1)
}

console.log('\nLint ratchet OK — no workspace gained warnings.')
