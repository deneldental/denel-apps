/**
 * Guard: no hand-rolled money formatting.
 *
 * WHY THIS EXISTS
 * ---------------
 * Migration 0209 changed the unit of every money value crossing the API from
 * cedis to integer minor units (pesewas; the code calls them "cents"). There is
 * exactly one cents-aware formatter — `formatCurrency` / `formatAmount` in
 * `@denel/utils` — but nothing forced its use, so components hand-rolled
 * `GHS ${Number(x).toFixed(2)}` and printed values 100x too large. A GHS
 * 18,000.00 invoice reached the patient as "GHS 1800000.00".
 *
 * The bug was invisible to every existing gate: it typechecks, it lints, and no
 * test renders a slip. See project-docs/money-unit-audit-and-remediation.md.
 *
 * HOW IT WORKS — a ratchet, not a ban
 * -----------------------------------
 * Banning the pattern outright would fail the build until the whole backlog is
 * cleared (T8). Instead the known sites are frozen below with their current
 * counts, and this test fails when:
 *
 *   1. a file NOT in the list grows one        -> the class cannot spread
 *   2. a listed file grows MORE than recorded  -> a file cannot get worse
 *   3. a listed file has FEWER than recorded   -> update the number (or delete
 *                                                 the entry); the ratchet only
 *                                                 turns one way
 *
 * The list opened as the T8 worklist at 55 files / 91 sites and Phase 3 cleared
 * it: money sites were converted, correct ones moved to ALLOWED with a reason.
 *
 * Scope: the four Vite apps. `reports/` has none. The backend is swept
 * separately (T10) because most of it was already fixed by ef06f893.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Repo root, from `portals/`. */
const ROOT = resolve(__dirname, '../../..')
const APPS = ['portals', 'team', 'patient', 'hr']

/**
 * `.toFixed(2)`, `toLocaleString({ minimumFractionDigits })`, and
 * `style: 'currency'` are the ways this codebase has produced a money string by
 * hand without using `formatCurrency` / `formatAmount`. They are correct ONLY if
 * the value is already in cedis — which, since 0209, it never is when it came
 * from the API.
 */
const HAND_ROLLED =
  /\.toFixed\(2\)|toLocaleString\([^)]*minimumFractionDigits|style:\s*['"]currency['"]/

/**
 * Sites that are CORRECT as written. Each needs a reason, and the reason has to
 * say which unit the value is in — that is the whole question.
 *
 * Three legitimate kinds live here:
 *   - not money at all (a percentage, a rate, a file size)
 *   - money that is already in CEDIS (the Ghana tax engine works in cedis, and
 *     PAYE bracket bounds were deliberately left in cedis by migration 0209)
 *   - a deliberate cents -> cedis conversion feeding a TEXT INPUT, which needs a
 *     plain "9000.00" that `Number()` can parse back — `formatAmount` groups
 *     with commas and would break the round trip
 */
const ALLOWED: Record<string, string> = {
  // ── not money ──────────────────────────────────────────────────────────────
  'portals/src/features/services/pages/index.tsx': 'tax rate percentages, not money',
  'portals/src/features/tax-calculations/pages/index.tsx': 'effective tax rate percentage',
  'team/src/pages/requests/SuggestionSheet.tsx': 'attachment size in MB',
  'portals/src/features/messaging/components/sms-status-tab.tsx':
    "the SMS provider's own balance, from their API — unit is theirs, not ours; " +
    'the code already notes it may be a minor unit and nobody has confirmed which',

  // ── already cedis ──────────────────────────────────────────────────────────
  'hr/src/features/staff/components/staff-payment-builder.tsx':
    'form fields fed by the Ghana tax engine, which takes and returns CEDIS',
  'hr/src/features/tax-config/pages/index.tsx':
    'a rate percentage, plus PAYE bracket bounds — 0209 deliberately left ' +
    'lowerBoundMonthly/upperBoundMonthly in cedis because the PAYE engine ' +
    'compares them against gross pay in cedis',
  'portals/src/features/tax-config/pages/index.tsx':
    'same as the HR copy: a rate percentage plus the cedis PAYE bracket bounds',
  'portals/src/features/treatment-plans/components/treatment-plan-editor.tsx':
    'the running total of the CEDIS form state; the cents boundary is at load ' + 'and submit',
  'portals/src/features/inventory/pages/monthly-threshold.tsx':
    'monthly threshold estimated costs in local KV store, user-entered cedis',
  'portals/src/features/reports/pages/monthly.tsx':
    'InventoryReconciliation sample items, hardcoded cedis',
  'portals/src/shared/components/period-card.tsx': 'mock period card totals, cedis integer counts',
  'portals/src/features/expenses/components/period-card.tsx':
    'legacy unused copy of shared period-card',
  'hr/src/features/staff/pages/payroll-runs.tsx':
    'ghsCompact() explicitly divides cents by 100 for display-only variance card',

  // ── cents -> cedis for a text input (plain decimal, no grouping) ───────────
  'portals/src/features/appointments/components/check-in-payment-dialog.tsx':
    'validation message quoting the outstanding balance: (cents / 100).toFixed(2)',
  'portals/src/features/credit-notes/components/issue-credit-note-dialog.tsx':
    'centsToCedisInput() — seeds the amount field the user edits',
  'portals/src/features/deferred-revenue/pages/index.tsx':
    'seeds the recognition amount field from remainingDeferred cents',
  'portals/src/features/settings/components/payment-plan-template-dialog.tsx':
    'seeds payment plan template amount fields: (cents / 100).toFixed(2)',
}

/**
 * Frozen backlog: path -> number of hand-rolled sites. Shrink these.
 *
 * 2026-09-07: opened at 55 files / 91 sites; Phase 3 cleared it to one entry.
 * 2026-09-10: that last entry (wht-cit.tsx) is gone too — its WHT/CIT payloads
 * now go through `inputToCents` (the columns are integer pesewas, so sending
 * cedis was a 100x under-write). The backlog is empty; the ratchet's job is now
 * purely "no NEW file hand-rolls a money string".
 */
const LEGACY: Record<string, number> = {}

function isComment(line: string): boolean {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

function countInFile(absPath: string): number {
  let n = 0
  for (const line of readFileSync(absPath, 'utf-8').split('\n')) {
    if (isComment(line)) continue
    if (HAND_ROLLED.test(line)) n++
  }
  return n
}

/** Every `.ts`/`.tsx` under the four apps' `src/`, as repo-relative paths. */
function sourceFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(p)
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(
          p
            .slice(ROOT.length + 1)
            .split(sep)
            .join('/')
        )
      }
    }
  }
  for (const app of APPS) walk(join(ROOT, app, 'src'))
  return found
}

function scan(): Map<string, number> {
  const counts = new Map<string, number>()
  for (const rel of sourceFiles()) {
    const n = countInFile(join(ROOT, rel))
    if (n > 0) counts.set(rel, n)
  }
  return counts
}

describe('money formatting guard', () => {
  const counts = scan()

  it('no NEW file hand-rolls a money string — use formatCurrency/formatAmount', () => {
    const offenders = [...counts.keys()].filter((f) => !(f in LEGACY) && !(f in ALLOWED)).sort()

    expect(
      offenders,
      offenders.length
        ? `

These files format a 2-decimal number by hand:
` +
            offenders.map((f) => `  ${f}`).join('\n') +
            `

If it is money, use formatCurrency/formatAmount from ` +
            `@denel/utils — the value is in cents, and .toFixed(2) prints it ` +
            `100x too large. If it is NOT money (a percentage, a rate, a ` +
            `quantity), add it to ALLOWED with a one-line reason.
`
        : undefined
    ).toEqual([])
  })

  it('no listed file gets worse', () => {
    const worse = Object.entries(LEGACY)
      .map(([file, allowed]) => ({ file, allowed, actual: counts.get(file) ?? 0 }))
      .filter((r) => r.actual > r.allowed)

    expect(
      worse,
      worse.length
        ? `

` +
            worse.map((r) => `  ${r.file}: ${r.allowed} allowed, ${r.actual} found`).join('\n') +
            `

The backlog only shrinks.
`
        : undefined
    ).toEqual([])
  })

  it('the backlog list is not stale — fixed a file? drop its count', () => {
    const stale = Object.entries(LEGACY)
      .map(([file, allowed]) => ({ file, allowed, actual: counts.get(file) ?? 0 }))
      .filter((r) => r.actual < r.allowed)

    expect(
      stale,
      stale.length
        ? `

` +
            stale
              .map(
                (r) =>
                  `  ${r.file}: listed ${r.allowed}, now ${r.actual}` +
                  (r.actual === 0 ? ' — delete the entry' : ' — lower the number')
              )
              .join('\n') +
            `

This keeps the ratchet honest: progress has to be recorded.
`
        : undefined
    ).toEqual([])
  })
})
