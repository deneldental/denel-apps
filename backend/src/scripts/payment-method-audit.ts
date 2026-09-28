/**
 * payment-method-audit.ts — which payment-method slugs miss the GL mapping and
 * silently post to Cash on Hand (1000)?
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * `resolveChannelAccountId` (backend/src/lib/channel-accounts.ts) resolves a
 * payment `method` string to a GL cash / bank / clearing account CODE in this
 * order:
 *
 *     1. the `glAccountCode` an admin pinned on the `payment_methods` lookup row
 *        whose `name` equals `method`  (migration 0212)
 *     2. else `METHOD_TO_CODE[method]` — the closed map of 8 canonical slugs
 *     3. else `'1000'` (Cash on Hand)
 *
 * The `payment_methods` lookup is admin-configurable, so a clinic can create
 * slugs — `mobile_money`, `hubtel_pos`, `pos`, … — that step 2 does not know.
 * Until an admin pins a `glAccountCode` on them, every receipt on such a slug
 * debits Cash instead of the real bank / MoMo / card account. This script
 * replays that same resolution per DB and reports where money still lands in
 * Cash by fallback (step 3) — i.e. which slugs the fix has NOT yet reached.
 *
 * A slug that is not in `METHOD_TO_CODE` but DOES carry a `glAccountCode` on its
 * lookup row is fine — it is reported as "resolved via lookup", not a defect.
 *
 * ─── What it audits ──────────────────────────────────────────────────────────
 * Every table with a PERSISTED free-text payment-method column that feeds
 * `resolveChannelAccountId` (all ten call sites were traced from
 * channel-accounts.ts):
 *
 *   - payments.method        — passed STRAIGHT to resolveChannelAccountId, so an
 *                              unmapped slug hits the `?? '1000'` fallback as-is.
 *   - expenses.paymentMethod — run through expense-service.ts `normalizeMethod`
 *                              FIRST (fuzzy: "MTN MoMo" -> momo, "Visa" -> card…),
 *                              so its raw fallback behaviour differs. This script
 *                              replicates that normaliser (kept in sync by hand)
 *                              and reports where expense money STILL lands in
 *                              Cash because the normaliser could not place it.
 *
 * The other resolveChannelAccountId call sites — specialist payouts, bill
 * payments, inventory receipts, x-ray and retail sales, remittances, insurance
 * settlement — resolve the channel from a transient function argument or a
 * hard-coded slug, and the row they persist is a `payments` row. There is no
 * other table with a stored method column to scan.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *   doppler run -p framada-projects -c dev -- pnpm --filter backend payment-methods:audit
 *   doppler run -p framada-projects -c dev -- pnpm --filter backend payment-methods:audit -- --json
 *   node dist/scripts/payment-method-audit.js            # inside the prod image
 *
 * READ ONLY. It runs SELECT / GROUP BY only — it never writes and never issues
 * DDL. It exits non-zero when it finds rows on an unmapped method.
 */

import { formatCurrency } from '@denel/utils'
import * as dotenv from 'dotenv'
import { sql } from 'drizzle-orm'
import { getDb } from '../db'
import { accounts, expenses, paymentMethods, payments } from '../db/schema'
import type { PaymentMethod } from '../lib/channel-accounts'

dotenv.config({ path: '.dev.vars' })
dotenv.config()

/**
 * Mirror of the PRIVATE `METHOD_TO_CODE` in backend/src/lib/channel-accounts.ts
 * (step 2 of the resolution order). The map is not exported, so it is copied.
 * The `Record<PaymentMethod, string>` annotation makes this file fail to compile
 * if a canonical method is added to / removed from the `PaymentMethod` union
 * upstream without this copy being updated. Keep the codes in sync by eye.
 */
const METHOD_TO_CODE: Record<PaymentMethod, string> = {
  cash: '1000',
  card: '1030',
  momo: '1020',
  bank_transfer: '1010',
  transfer: '1010',
  cheque: '1010',
  insurance: '1210',
  wallet: '2200',
}

const CASH_ON_HAND = '1000'

/**
 * Verbatim copy of `normalizeMethod` from backend/src/lib/expense-service.ts.
 * Expenses run their raw `paymentMethod` through this before it ever reaches
 * `resolveChannelAccountId`, so the audit has to apply the same transform to
 * report expense exposure truthfully. Keep in sync with that file.
 */
const EXPENSE_KNOWN_METHODS: PaymentMethod[] = [
  'cash',
  'card',
  'momo',
  'bank_transfer',
  'transfer',
  'cheque',
]

function normalizeExpenseMethod(m: string | null): PaymentMethod {
  const s = (m ?? '').toLowerCase().trim().replace(/\s+/g, '_')
  if ((EXPENSE_KNOWN_METHODS as string[]).includes(s)) return s as PaymentMethod
  if (s.includes('momo') || s.includes('mobile') || s.includes('mtn')) return 'momo'
  if (s.includes('card')) return 'card'
  if (s.includes('cheque') || s.includes('check')) return 'cheque'
  if (s.includes('bank') || s.includes('transfer')) return 'bank_transfer'
  return 'cash'
}

/** `"MTN Mobile Money"` -> `"mtn_mobile_money"` — the shape a slug lookup expects. */
function slugify(v: string): string {
  return v.toLowerCase().trim().replace(/\s+/g, '_')
}

interface GroupRow {
  method: string | null
  count: number
  amount: number
}

interface ClassifiedRow extends GroupRow {
  /** Raw value literally present as a key in METHOD_TO_CODE (step 2). */
  inMap: boolean
  /** Non-null `glAccountCode` pinned on this method's lookup row (step 1), else null. */
  pinnedGlCode: string | null
  /** GL code the money actually debits once resolveChannelAccountId runs. */
  postsToCode: string
  /** How `postsToCode` was reached: 'lookup' (step 1), 'map' (step 2), 'fallback' (step 3). */
  resolvedVia: 'lookup' | 'map' | 'fallback'
  /** Present in the admin `payment_methods` lookup (exact or slugified match). */
  inLookup: boolean
  /** Lookup row's `isActive`, or null when not in the lookup. */
  lookupActive: boolean | null
  /**
   * Money is landing in Cash on Hand by FALLBACK (step 3) without the user
   * having chosen "cash" — a real mis-post the fix has not reached. A slug that
   * resolves via a pinned `glAccountCode` or via METHOD_TO_CODE is NOT misposted,
   * even to 1000 (that would be a deliberate mapping).
   */
  misposted: boolean
}

interface TableReport {
  table: string
  column: string
  normalized: boolean
  rows: ClassifiedRow[]
  totalRows: number
  totalAmount: number
  mispostedRows: number
  mispostedAmount: number
  unmappedValues: number
  unmappedRows: number
  unmappedAmount: number
}

type Db = ReturnType<typeof getDb>

async function groupPayments(db: Db): Promise<GroupRow[]> {
  const rows = await db
    .select({
      method: payments.method,
      count: sql<number>`COUNT(*)::int`,
      amount: sql<string>`COALESCE(SUM(${payments.amount}), 0)::text`,
    })
    .from(payments)
    .groupBy(payments.method)
  return rows
    .map((r) => ({ method: r.method, count: Number(r.count), amount: Number(r.amount) }))
    .sort((a, b) => b.amount - a.amount)
}

async function groupExpenses(db: Db): Promise<GroupRow[]> {
  const rows = await db
    .select({
      method: expenses.paymentMethod,
      count: sql<number>`COUNT(*)::int`,
      amount: sql<string>`COALESCE(SUM(${expenses.amount}), 0)::text`,
    })
    .from(expenses)
    .groupBy(expenses.paymentMethod)
  return rows
    .map((r) => ({ method: r.method, count: Number(r.count), amount: Number(r.amount) }))
    .sort((a, b) => b.amount - a.amount)
}

function classify(
  group: GroupRow[],
  opts: {
    normalize: boolean
    lookup: Map<string, boolean>
    /** name / slugified-name -> non-null `glAccountCode` (step 1 of resolution). */
    glCodes: Map<string, string>
  }
): ClassifiedRow[] {
  return group.map((g) => {
    const raw = g.method
    const slug = raw === null ? '' : slugify(raw)
    const inMap = raw !== null && Object.hasOwn(METHOD_TO_CODE, raw)

    // The method string resolveChannelAccountId actually receives: for expenses
    // it is the normalised slug, for payments the raw value verbatim.
    const resolvedKey = opts.normalize ? normalizeExpenseMethod(raw) : (raw ?? '')
    const pinnedGlCode =
      opts.glCodes.get(resolvedKey) ?? opts.glCodes.get(slugify(resolvedKey)) ?? null

    let postsToCode: string
    let resolvedVia: ClassifiedRow['resolvedVia']
    if (pinnedGlCode) {
      postsToCode = pinnedGlCode
      resolvedVia = 'lookup'
    } else if (opts.normalize) {
      // expenses: the normaliser always yields a METHOD_TO_CODE key.
      postsToCode = METHOD_TO_CODE[normalizeExpenseMethod(raw)]
      resolvedVia = 'map'
    } else if (raw !== null && Object.hasOwn(METHOD_TO_CODE, raw)) {
      postsToCode = METHOD_TO_CODE[raw as PaymentMethod]
      resolvedVia = 'map'
    } else {
      postsToCode = CASH_ON_HAND
      resolvedVia = 'fallback'
    }

    // Misposted = reached Cash by FALLBACK, and the user did not pick "cash".
    const misposted = resolvedVia === 'fallback' && slug !== 'cash'

    const inLookup = raw !== null && (opts.lookup.has(raw) || opts.lookup.has(slug))
    const lookupActive = inLookup
      ? (opts.lookup.get(raw ?? '') ?? opts.lookup.get(slug) ?? null)
      : null

    return {
      ...g,
      inMap,
      pinnedGlCode,
      postsToCode,
      resolvedVia,
      inLookup,
      lookupActive,
      misposted,
    }
  })
}

function summarise(
  table: string,
  column: string,
  normalized: boolean,
  rows: ClassifiedRow[]
): TableReport {
  const unmapped = rows.filter((r) => !r.inMap)
  const misposted = rows.filter((r) => r.misposted)
  return {
    table,
    column,
    normalized,
    rows,
    totalRows: rows.reduce((n, r) => n + r.count, 0),
    totalAmount: rows.reduce((n, r) => n + r.amount, 0),
    mispostedRows: misposted.reduce((n, r) => n + r.count, 0),
    mispostedAmount: misposted.reduce((n, r) => n + r.amount, 0),
    unmappedValues: unmapped.length,
    unmappedRows: unmapped.reduce((n, r) => n + r.count, 0),
    unmappedAmount: unmapped.reduce((n, r) => n + r.amount, 0),
  }
}

function printTable(report: TableReport, accountName: (code: string) => string): void {
  console.log('')
  console.log(`── ${report.table}.${report.column} ──────────────────────────────────`)
  if (report.normalized) {
    console.log('   values pass through expense-service normalizeMethod() before')
    console.log('   resolveChannelAccountId — "posts to" reflects the normalised slug')
  }
  if (report.rows.length === 0) {
    console.log('   (no rows)')
    return
  }

  console.log('')
  const header =
    'METHOD'.padEnd(24) +
    'ROWS'.padStart(8) +
    'AMOUNT'.padStart(18) +
    '  ' +
    'IN MAP'.padEnd(8) +
    'POSTS TO'.padEnd(28) +
    'LOOKUP'.padEnd(16)
  console.log(`   ${header}`)

  for (const r of report.rows) {
    const label = r.method === null ? '(null / empty)' : r.method
    const lookupBase = !r.inLookup
      ? '—'
      : r.lookupActive === false
        ? 'yes (inactive)'
        : 'yes (active)'
    const lookup = r.pinnedGlCode ? `${lookupBase} +GL` : lookupBase
    const postsTo = `${r.postsToCode} ${accountName(r.postsToCode)}`
    const flag = r.misposted
      ? '  ✗ MISPOSTED -> Cash (fallback)'
      : r.resolvedVia === 'lookup'
        ? '  · resolved via lookup glAccountCode'
        : r.inMap
          ? ''
          : '  · not in map'
    const line =
      label.padEnd(24) +
      String(r.count).padStart(8) +
      formatCurrency(r.amount).padStart(18) +
      '  ' +
      (r.inMap ? 'yes' : 'no').padEnd(8) +
      postsTo.padEnd(28) +
      lookup.padEnd(16) +
      flag
    console.log(`   ${line}`)
  }

  console.log('')
  console.log(`   totals: ${report.totalRows} row(s), ${formatCurrency(report.totalAmount)}`)
  console.log(
    `   not in METHOD_TO_CODE: ${report.unmappedValues} value(s), ${report.unmappedRows} row(s), ` +
      `${formatCurrency(report.unmappedAmount)} (fine when resolved via lookup glAccountCode)`
  )
  console.log(
    `   MISPOSTED to Cash by fallback: ${report.mispostedRows} row(s), ` +
      `${formatCurrency(report.mispostedAmount)}`
  )
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('ERROR: DATABASE_URL is not set. Run via `doppler run -- …` or export it.')
    process.exit(1)
  }
  const asJson = process.argv.includes('--json')
  const db = getDb(url)

  // Account code -> name, straight from the live CoA (the same source
  // resolveChannelAccountId reads). Codes that are not seeded render as such.
  const accountRows = await db.select({ code: accounts.code, name: accounts.name }).from(accounts)
  const accountNameByCode = new Map(accountRows.map((a) => [a.code, a.name] as const))
  const accountName = (code: string): string => accountNameByCode.get(code) ?? '(not seeded)'

  // Admin payment_methods lookup: name -> isActive, and (step 1 of resolution)
  // name -> pinned glAccountCode. Both keyed by the stored name AND its
  // slugified form so "Mobile Money" and "mobile_money" match either way.
  const lookupRows = await db
    .select({
      name: paymentMethods.name,
      isActive: paymentMethods.isActive,
      glAccountCode: paymentMethods.glAccountCode,
    })
    .from(paymentMethods)
  const lookup = new Map<string, boolean>()
  const glCodes = new Map<string, string>()
  for (const row of lookupRows) {
    lookup.set(row.name, row.isActive)
    lookup.set(slugify(row.name), row.isActive)
    if (row.glAccountCode) {
      glCodes.set(row.name, row.glAccountCode)
      glCodes.set(slugify(row.name), row.glAccountCode)
    }
  }

  const reports: TableReport[] = [
    summarise(
      'payments',
      'method',
      false,
      classify(await groupPayments(db), { normalize: false, lookup, glCodes })
    ),
    summarise(
      'expenses',
      'paymentMethod',
      true,
      classify(await groupExpenses(db), { normalize: true, lookup, glCodes })
    ),
  ]

  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return '(unparseable host)'
    }
  })()

  const unmappedRows = reports.reduce((n, r) => n + r.unmappedRows, 0)
  const unmappedAmount = reports.reduce((n, r) => n + r.unmappedAmount, 0)
  const unmappedValues = reports.reduce((n, r) => n + r.unmappedValues, 0)
  const mispostedRows = reports.reduce((n, r) => n + r.mispostedRows, 0)
  const mispostedAmount = reports.reduce((n, r) => n + r.mispostedAmount, 0)

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          database: host,
          mappedMethods: Object.keys(METHOD_TO_CODE),
          tables: reports.map((r) => ({
            table: r.table,
            column: r.column,
            normalizedFirst: r.normalized,
            totalRows: r.totalRows,
            totalAmountCents: r.totalAmount,
            unmappedValues: r.unmappedValues,
            unmappedRows: r.unmappedRows,
            unmappedAmountCents: r.unmappedAmount,
            mispostedToCashRows: r.mispostedRows,
            mispostedToCashAmountCents: r.mispostedAmount,
            methods: r.rows.map((m) => ({
              method: m.method,
              count: m.count,
              amountCents: m.amount,
              inMethodToCode: m.inMap,
              pinnedGlAccountCode: m.pinnedGlCode,
              postsToCode: m.postsToCode,
              resolvedVia: m.resolvedVia,
              inPaymentMethodsLookup: m.inLookup,
              lookupIsActive: m.lookupActive,
              mispostedToCash: m.misposted,
            })),
          })),
          totals: {
            unmappedValues,
            unmappedRows,
            unmappedAmountCents: unmappedAmount,
            mispostedToCashRows: mispostedRows,
            mispostedToCashAmountCents: mispostedAmount,
          },
          ok: mispostedRows === 0,
        },
        null,
        2
      )
    )
    process.exit(mispostedRows === 0 ? 0 : 1)
  }

  console.log('Payment-method -> GL account mapping audit')
  console.log(`  database        ${host}`)
  console.log(`  mapped methods  ${Object.keys(METHOD_TO_CODE).join(', ')}`)
  console.log('  resolution      1) lookup glAccountCode  2) METHOD_TO_CODE  3) fallback')
  console.log(
    `  fallback        any unresolved slug -> ${CASH_ON_HAND} ${accountName(CASH_ON_HAND)}`
  )
  console.log('  tables audited  payments.method, expenses.paymentMethod')

  for (const report of reports) printTable(report, accountName)

  console.log('')
  console.log('Summary')
  console.log(`  values not in METHOD_TO_CODE   ${unmappedValues}  (ok when pinned via lookup)`)
  console.log(`  rows on such a value           ${unmappedRows}`)
  console.log(`  amount on such a value         ${formatCurrency(unmappedAmount)}`)
  console.log(
    `  MISPOSTED to Cash by fallback  ${mispostedRows} row(s), ${formatCurrency(mispostedAmount)}`
  )
  console.log('')

  if (mispostedRows === 0) {
    console.log('✓ PASS — every recorded payment / expense method resolves to a real')
    console.log('  GL channel, via METHOD_TO_CODE or a pinned lookup glAccountCode.')
    console.log('  Nothing falls back to Cash on Hand.')
    process.exit(0)
  }

  console.log('✗ FAIL — money is recorded against payment-method slugs that neither')
  console.log('  METHOD_TO_CODE nor a payment_methods.glAccountCode resolves, so')
  console.log(`  resolveChannelAccountId falls back to Cash on Hand (${CASH_ON_HAND}) instead of`)
  console.log('  the real bank / MoMo / card account. Pin a glAccountCode on each')
  console.log('  flagged method in Settings -> Finance & Billing -> Payment Methods,')
  console.log('  then reclassify the affected journal entries.')
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
