/**
 * Guard: no new manual-fetch component joins the backlog.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this migration, the portal had no consistent refresh model: a screen
 * fetched its own data in a `useEffect`, kept it in local `useState`, and had
 * no way to learn that another screen had changed the same data — the only
 * fix was an F5. See project-docs/money-unit-audit-and-remediation.md's sibling
 * effort and the `data-refresh-migration-progress` memory for the phased plan.
 *
 * The fix is `useApiQuery`/`useApiMutation` (portals/src/lib/query.ts) keyed
 * via `portals/src/lib/query-keys.ts`, plus `useLookup`/`useLookupAdmin`
 * (portals/src/shared/hooks/use-lookup.ts) for the `/api/lookups/:type` shape.
 * Once a screen is on the kit, a write anywhere that invalidates the same key
 * refreshes every reader — no reload.
 *
 * HOW IT WORKS — a ratchet, not a ban
 * -----------------------------------
 * Rewriting the ~194-file backlog in one sitting isn't realistic. Instead the
 * known offenders are frozen below with their current `useEffect(` count, and
 * this test fails when:
 *
 *   1. a file NOT in the list grows one       -> the class cannot spread
 *   2. a listed file grows MORE than recorded -> a file cannot get worse
 *   3. a listed file has FEWER than recorded  -> update the number (or delete
 *                                                the entry); the ratchet only
 *                                                turns one way
 *
 * The list opened at the count below on 2026-09-11 (Phase 2 progress: payment
 * methods, module visibility, appointment types, units, categories, expense
 * categories, appointment/patient pickers, the appointments/patients/labs main
 * list pages, CRM campaign pages, compliance categories, patient tags,
 * document tags, x-ray types). Shrink it as each remaining screen migrates.
 *
 * THE HEURISTIC (and its limits)
 * -------------------------------
 * A file counts as "still manual-fetch" when it has a `useEffect` AND imports
 * something from `@/lib/actions/*` AND does not itself call the kit (directly,
 * or through one of the wrapper hooks listed in KIT_MARKERS — e.g.
 * `useLookup`, `useModuleVisibility`, `usePaymentMethods`). Comments are
 * skipped on both sides of that check.
 *
 * This is a proxy, not a parser: a file that uses `useEffect` for something
 * unrelated to fetching (a debounce timer, a page-reset-on-filter effect)
 * while also importing an action for an unrelated concern (e.g. a mutation
 * fired from a button handler) can be flagged without truly being "still on
 * the old pattern." Rather than ban the class outright, false positives get
 * added to ALLOWED with a one-line reason — same policy as
 * money-formatting-guard.test.ts. New wrapper hooks built on the kit should be
 * added to KIT_MARKERS so their callers stop being flagged.
 *
 * Scope: `portals/` only. The kit (`useApiQuery` etc.) doesn't exist yet in
 * `team`/`patient`/`hr` — scanning them would flag every file, uselessly.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Repo root, from `portals/`. */
const ROOT = resolve(__dirname, '../../..')
const APPS = ['portals']

/**
 * Direct kit calls, plus every wrapper hook built on top of the kit so far.
 * A file calling one of these — even indirectly through its own hook — is
 * considered migrated for the purpose of this guard. Add new wrapper hooks
 * here as they're built, so their callers don't get flagged as backlog.
 *
 * `(?:<[^()]*>)?` tolerates a generic type argument between the hook name and
 * its call, e.g. `useApiQuery<Product[]>(...)` — without it, a typed call was
 * invisible to this check and its file stayed flagged despite being migrated.
 *
 * `useQuery`/`useMutation` (raw `@tanstack/react-query`, not the wrapper) are
 * included too: a handful of `lib/actions/*` fetchers already unwrap the
 * `{success,data,error}` envelope themselves, so their callers correctly use
 * TanStack Query directly instead of `useApiQuery`/`useApiMutation` — that is
 * still "on the kit" for this guard's purpose (e.g.
 * `financial-records/pages/{index,print}.tsx`, `clinic-ledger/pages/index.tsx`).
 */
const KIT_HOOK_NAMES = [
  'useApiQuery',
  'useApiMutation',
  'useQuery',
  'useMutation',
  'useLookup',
  'useLookupAdmin',
  'useModuleVisibility',
  'usePaymentMethods',
  'useComplianceCategories',
  'usePatientTagCatalog',
  'useCrmCampaignEntries',
  'useAppointmentPickers',
  'useInventoryLocations',
]
const KIT_MARKERS = new RegExp(
  KIT_HOOK_NAMES.map((name) => `\\b${name}\\b\\s*(?:<[^()]*>)?\\s*\\(`).join('|')
)

/** Any import from the server-action layer — the data a manual fetch pulls from. */
const ACTION_IMPORT = /from ['"]@\/lib\/actions\//

/**
 * Sites that look like backlog but are not. Each needs a reason, and the
 * reason has to say why the `useEffect` + action-import combination here
 * isn't really "still on the old fetch pattern."
 */
const ALLOWED: Record<string, string> = {
  'portals/src/features/analytics/components/analytics-header.tsx':
    'the only useEffect is a fake progress-bar timer for the PDF export button, not a data fetch; exportAnalyticsPdf is called from a click handler',
  'portals/src/features/expenses/components/create-year-dialog.tsx':
    'the only useEffect resets local form state when the dialog closes; createExpenseYear is called from the submit handler and already invalidates queryKeys.expenses.all via useQueryClient',
  'portals/src/features/credit-notes/components/issue-credit-note-dialog.tsx':
    'the only useEffect seeds the amount field from props when the dialog opens, not a fetch; createAndPostCreditNote is a GL-posting write called from the submit handler and deliberately left untouched (financially-sensitive)',
  'portals/src/features/payments/components/reverse-payment-dialog.tsx':
    'the only useEffect resets the reason textarea when the dialog opens, not a fetch; reversePayment is a GL-posting write called from the submit handler and deliberately left untouched (financially-sensitive)',
  'portals/src/features/payments/components/wallet-topup-dialog.tsx':
    'the only useEffect resets form fields when the dialog opens, not a fetch; createDraftPayment/postDraftPayment are GL-posting writes called from the submit handler and deliberately left untouched (financially-sensitive)',
}

/**
 * Frozen backlog: path -> number of `useEffect(` call sites in a file that
 * still imports `@/lib/actions/*` without using the kit. Shrink these.
 *
 * Opened 2026-09-11 at 194 files / 279 sites.
 */
const LEGACY: Record<string, number> = {
  'portals/src/features/dashboard/pages/index.tsx': 1,
  'portals/src/features/integrations/pages/index.tsx': 1,
  'portals/src/features/payments/components/invoice-view-sheet.tsx': 2,
}

function isComment(line: string): boolean {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

/** Every `.ts`/`.tsx` under `portals/src`, as a repo-relative path. */
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

/** 0 if the file is clean (no `useEffect`, doesn't import actions, or already uses the kit). */
function countInFile(absPath: string): number {
  const lines = readFileSync(absPath, 'utf-8').split('\n')
  let hasUseEffect = false
  let importsActions = false
  let usesKit = false
  let effectSites = 0
  for (const line of lines) {
    if (isComment(line)) continue
    if (/\buseEffect\b/.test(line)) hasUseEffect = true
    if (ACTION_IMPORT.test(line)) importsActions = true
    if (KIT_MARKERS.test(line)) usesKit = true
    if (/useEffect\(/.test(line)) effectSites++
  }
  if (!hasUseEffect || !importsActions || usesKit) return 0
  return effectSites
}

function scan(): Map<string, number> {
  const counts = new Map<string, number>()
  for (const rel of sourceFiles()) {
    const n = countInFile(join(ROOT, rel))
    if (n > 0) counts.set(rel, n)
  }
  return counts
}

describe('data refresh guard', () => {
  const counts = scan()

  it('no NEW file joins the manual-fetch backlog — use useApiQuery/useApiMutation/useLookup', () => {
    const offenders = [...counts.keys()].filter((f) => !(f in LEGACY) && !(f in ALLOWED)).sort()

    expect(
      offenders,
      offenders.length
        ? `

These files fetch data in a useEffect + @/lib/actions call without using the
refresh kit:
` +
            offenders.map((f) => `  ${f}`).join('\n') +
            `

Use useApiQuery/useApiMutation (portals/src/lib/query.ts) or useLookup/` +
            `useLookupAdmin (portals/src/shared/hooks/use-lookup.ts) for ` +
            `/api/lookups/:type. If the useEffect here truly isn't a data fetch ` +
            `(e.g. it's a debounce timer, and the action import is for an ` +
            `unrelated button handler), add it to ALLOWED with a one-line reason.
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

  it('the backlog list is not stale — migrated a file? drop or lower its count', () => {
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
