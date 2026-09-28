/**
 * xray-charge-service.ts — admin-v1 §9.6 / §9.7.
 *
 * §9.6 — auto-charge an X-ray from the `xray` Services catalog (mirrors the
 * lab-case auto-invoice in `lab-case-billing.ts`):
 *
 *   - INTERNAL (a registered patient) → a patient INVOICE line, issued to the GL
 *     via the same `issueInvoice` path the lab/walk-in flows use
 *     (DR 1200 AR / CR 4100 Diagnostic revenue + 2300 tax).
 *   - EXTERNAL (name + phone, §9.5 — no patient AR to invoice) → a DIRECT
 *     point-of-service receipt: DR 1000 Cash / CR 4100 revenue (+ 2300 tax),
 *     posted with `postInOpenPeriod`. No invoice, no AR — the money is taken
 *     at the counter.
 *
 * The charge is OVERRIDABLE: the caller may pass an explicit `amountOverride`
 * (e.g. a comped re-take priced at 0 skips the post) or `skipCharge: true` to
 * suppress it entirely. It is also BEST-EFFORT / non-blocking, exactly like the
 * other Phase-4 GL postings: a missing `xray` catalog price, a missing CoA
 * account, or a closed period comes back as a `reason` — it never throws into
 * the X-ray-create path, so capturing an image is never blocked by billing.
 *
 * §9.7 — `getXrayDailySummary` rolls the day's X-ray activity into a
 * `ModuleSummary` for the unified daily digest: internal/external split,
 * revenue (priced from the same catalog), the X-ray expense-category spend, and
 * the VAT/exempt tax component. EXPORTED for the digest provider (the route owns
 * registration; this file owns the math).
 *
 * NOTE (schema gap, flagged — NO migration here): `xray_records` has no
 * `invoiceId` / `chargeId` column, so we cannot persist the charge linkage on
 * the record. `autoChargeXray` returns the created invoice/entry id to the
 * caller; a follow-up migration should add `xray_records.invoiceId uuid` (FK →
 * invoices, on delete set null) so the linkage is queryable. Until then, §9.7's
 * revenue is re-derived from the day's records × catalog price, not from the
 * charge rows.
 */

import { computeGhanaTax, Money } from '@denel/utils'
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { accounts, expenses, invoiceLines, invoices, services, xrayRecords } from '../db/schema'
import { resolveChannelAccountId } from './channel-accounts'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import { postInOpenPeriod } from './gl-service'
import { computeLine, issueInvoice } from './invoice-service'
import { generateInvoiceNumber } from './ledger-service'
import { getTaxRates } from './tax-config'

/**
 * Imaging maps to `4100 Revenue — Diagnostic` (the ADA Diagnostic bucket),
 * i.e. FINANCE_ACCOUNTS.XRAY_REVENUE. A dedicated "Revenue — Imaging" account
 * can be added via a CoA migration later if reporting calls for it — same
 * rationale as lab work → 4170.
 */

/**
 * Substring an admin-creatable X-ray expense category name must contain to be
 * counted in the §9.7 expense figure (case-insensitive). Catches "X-ray",
 * "Xray", "Imaging consumables", etc. without needing a fixed seeded id.
 */
const XRAY_EXPENSE_MATCH = '%xray%'
const IMAGING_EXPENSE_MATCH = '%imaging%'

export type XrayChargeKind = 'invoice' | 'direct' | 'skipped'
export type XrayChargeReason =
  | 'skipped'
  | 'zero_amount'
  | 'no_price'
  | 'no_revenue_account'
  | 'closed_period'

export interface XrayChargeResult {
  charged: boolean
  kind: XrayChargeKind
  /** Set when an internal invoice was created. */
  invoiceId?: string
  /** Set when a direct (external) receipt was posted to the GL. */
  journalPosted?: boolean
  /** The resolved unit price actually charged (override or catalog). */
  amount?: number
  reason?: XrayChargeReason
}

export interface XrayPrice {
  serviceId: string
  name: string
  amount: number
  /** 'exempt' (default, clinical) | 'standard' | 'zero_rated'. */
  taxStatus: string
}

/**
 * Resolve the active `xray` catalog price for an X-ray type. Returns null when
 * the type is unpriced (no active xray service points at it) — the caller then
 * treats the charge as a no-op (non-blocking).
 */
export async function resolveXrayPrice(
  db: DB,
  xrayTypeId: string | null | undefined
): Promise<XrayPrice | null> {
  if (!xrayTypeId) return null
  const [row] = await db
    .select({
      serviceId: services.id,
      name: services.name,
      amount: services.amount,
      taxStatus: services.taxStatus,
    })
    .from(services)
    .where(
      and(
        eq(services.category, 'xray'),
        eq(services.xrayTypeId, xrayTypeId),
        eq(services.isActive, true),
        eq(services.status, 'active')
      )
    )
    .limit(1)
  if (!row) return null
  return {
    serviceId: row.serviceId,
    name: row.name,
    amount: Number(row.amount),
    taxStatus: row.taxStatus ?? 'exempt',
  }
}

/** The standard blended Ghana levy rate (VAT+NHIL+GETFund) as a percentage. */
async function standardRatePct(db: DB): Promise<number> {
  const rates = await getTaxRates(db)
  return computeGhanaTax(100, { rates }).effectiveRate * 100
}

type XrayRecordRow = typeof xrayRecords.$inferSelect

export interface AutoChargeXrayInput {
  record: Pick<XrayRecordRow, 'id' | 'patientId' | 'xrayTypeId' | 'origin'>
  userId: string
  /** Explicit price override (re-take, comp). `0` posts nothing (zero_amount). */
  amountOverride?: number | null
  /** Skip billing entirely for this capture. */
  skipCharge?: boolean
  /** Payment channel for an EXTERNAL direct receipt. Defaults to cash. */
  method?: 'cash' | 'card' | 'momo' | 'bank_transfer' | 'transfer' | 'cheque'
  /** Charge date — defaults to now. */
  entryDate?: Date
}

/**
 * Auto-charge a freshly-created X-ray. Internal → patient invoice; external →
 * direct GL receipt. Overridable + skippable + best-effort: returns a result
 * (never throws for a billing-config gap), so the X-ray-create path is safe to
 * `await` this and surface `reason` without failing the capture.
 */
export async function autoChargeXray(
  db: DB,
  input: AutoChargeXrayInput
): Promise<XrayChargeResult> {
  const { record, userId } = input

  if (input.skipCharge) return { charged: false, kind: 'skipped', reason: 'skipped' }

  // Resolve the amount: an explicit override wins; otherwise the catalog price.
  let amount: number
  let taxStatus = 'exempt'
  let description = 'X-ray'
  if (input.amountOverride != null) {
    amount = Number(input.amountOverride)
    // Keep the catalog's tax classification if the type is priced, so an
    // overridden amount still posts the right VAT split.
    const price = await resolveXrayPrice(db, record.xrayTypeId)
    if (price) {
      taxStatus = price.taxStatus
      description = price.name
    }
  } else {
    const price = await resolveXrayPrice(db, record.xrayTypeId)
    if (!price) return { charged: false, kind: 'skipped', reason: 'no_price' }
    amount = price.amount
    taxStatus = price.taxStatus
    description = price.name
  }

  if (!(amount > 0)) return { charged: false, kind: 'skipped', amount, reason: 'zero_amount' }

  const taxRate = taxStatus === 'standard' ? await standardRatePct(db) : 0
  const entryDate = input.entryDate ?? new Date()

  if (record.origin === 'external') {
    return chargeExternal(db, {
      amount,
      taxRate,
      description,
      method: input.method,
      userId,
      entryDate,
    })
  }
  return chargeInternal(db, {
    patientId: record.patientId,
    amount,
    taxRate,
    description,
    userId,
    entryDate,
  })
}

/**
 * INTERNAL — a patient invoice (draft + one line @ catalog price, then issue).
 * Mirrors `createInternalLabInvoice`: revenue → 4100, tax via the line's
 * `taxRate`, issued to the GL inside one transaction.
 */
async function chargeInternal(
  db: DB,
  args: {
    patientId: string
    amount: number
    taxRate: number
    description: string
    userId: string
    entryDate: Date
  }
): Promise<XrayChargeResult> {
  const [revenue] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.code, FINANCE_ACCOUNTS.XRAY_REVENUE))
    .limit(1)
  if (!revenue) return { charged: false, kind: 'skipped', reason: 'no_revenue_account' }

  const computed = computeLine({
    quantity: 1,
    unitPrice: args.amount,
    discountType: 'none',
    discountValue: 0,
    taxRate: args.taxRate,
  })

  try {
    const invoiceId = await db.transaction(async (tx) => {
      const invoiceNumber = await generateInvoiceNumber(tx)
      const [invoice] = await tx
        .insert(invoices)
        .values({
          invoiceNumber,
          patientId: args.patientId,
          type: 'one_time',
          status: 'draft',
          amount: 0,
          paidAmount: 0,
          subtotal: 0,
          discountTotal: 0,
          taxableAmount: 0,
          taxTotal: 0,
          total: 0,
          balance: 0,
          currency: 'GHS',
          description: `X-ray: ${args.description}`,
          createdBy: args.userId,
        })
        .returning()

      await tx.insert(invoiceLines).values({
        invoiceId: invoice.id,
        lineNumber: 1,
        description: `X-ray — ${args.description}`,
        quantity: 1,
        unitPrice: computed.unitPrice,
        discountType: 'none',
        discountValue: 0,
        discountAmount: 0,
        lineSubtotal: computed.lineSubtotal,
        lineAfterDiscount: computed.lineAfterDiscount,
        taxRate: args.taxRate,
        taxAmount: computed.taxAmount,
        lineTotal: computed.lineTotal,
        revenueAccountId: revenue.id,
        deferRevenue: false,
      })

      await issueInvoice(tx, invoice.id, args.userId, { entryDate: args.entryDate })
      return invoice.id
    })
    return { charged: true, kind: 'invoice', invoiceId, amount: args.amount }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).toLowerCase()
    if (msg.includes('period') || msg.includes('closed')) {
      return { charged: false, kind: 'skipped', amount: args.amount, reason: 'closed_period' }
    }
    throw e // a genuine GL bug must surface, not hide
  }
}

/**
 * EXTERNAL — a direct point-of-service receipt. No patient AR: DR cash / CR
 * 4100 revenue (+ 2300 tax on the standard portion). Reuses the `retail_sale`
 * GL source type (the existing "direct cash sale, no AR" shape already in the
 * source_doc_type CHECK constraint) so no migration is needed.
 */
async function chargeExternal(
  db: DB,
  args: {
    amount: number
    taxRate: number
    description: string
    method?: 'cash' | 'card' | 'momo' | 'bank_transfer' | 'transfer' | 'cheque'
    userId: string
    entryDate: Date
  }
): Promise<XrayChargeResult> {
  const [revenue] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.code, FINANCE_ACCOUNTS.XRAY_REVENUE))
    .limit(1)
  if (!revenue) return { charged: false, kind: 'skipped', reason: 'no_revenue_account' }

  // taxRate applies to the net; total collected = net + tax.
  const net = Money.from(args.amount)
  const tax = net.percent(args.taxRate)
  const gross = net.add(tax)

  let cashId: string
  let taxAcctId: string | undefined
  try {
    cashId = await resolveChannelAccountId(db, args.method ?? 'cash')
    if (tax.isPositive()) {
      const [taxAcct] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.code, FINANCE_ACCOUNTS.TAX_PAYABLE))
        .limit(1)
      if (!taxAcct) return { charged: false, kind: 'skipped', reason: 'no_revenue_account' }
      taxAcctId = taxAcct.id
    }
  } catch {
    return { charged: false, kind: 'skipped', reason: 'no_revenue_account' }
  }

  const lines = [
    { accountId: cashId, debit: gross, description: `X-ray (external) — ${args.description}` },
    {
      accountId: revenue.id,
      credit: net,
      description: `X-ray imaging revenue — ${args.description}`,
    },
  ]
  if (taxAcctId && tax.isPositive()) {
    lines.push({ accountId: taxAcctId, credit: tax, description: 'Output tax on X-ray' })
  }

  const outcome = await postInOpenPeriod(
    db,
    {
      sourceDocType: 'retail_sale',
      sourceDocId: null,
      description: `X-ray (external): ${args.description}`,
      createdBy: args.userId,
      lines,
    },
    args.entryDate
  )
  if (outcome !== 'posted') {
    return {
      charged: false,
      kind: 'direct',
      journalPosted: false,
      amount: args.amount,
      reason: 'closed_period',
    }
  }
  return { charged: true, kind: 'direct', journalPosted: true, amount: args.amount }
}

// ─── §9.7 — X-ray mini-report aggregator ─────────────────────────────────────

export interface ModuleSummaryMetric {
  label: string
  value: string | number
}
export interface ModuleSummary {
  module: string
  title: string
  metrics: ModuleSummaryMetric[]
}

const ghs = (m: Money) => `GHS ${m.toNumber().toFixed(2)}`

/**
 * §9.7 — the X-ray mini-report for `date`. Splits the day's captures by
 * internal/external, prices each from the same `xray` catalog the auto-charge
 * uses (so revenue reconciles with §9.6), adds the day's X-ray expense-category
 * spend, and reports the VAT/exempt tax component.
 *
 * Returns null when nothing happened (no captures, no spend) so the digest
 * omits an empty block — consistent with the other providers.
 *
 * Revenue is re-derived from records × catalog price (rather than read from the
 * charge rows) because `xray_records` has no charge-linkage column yet — see the
 * file header NOTE. The figure still reconciles because the same catalog price
 * drives both the §9.6 charge and this report.
 */
export async function getXrayDailySummary(db: DB, date: Date): Promise<ModuleSummary | null> {
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(date)
  dayEnd.setHours(23, 59, 59, 999)

  // The day's captures with their type's active catalog price (left join — an
  // unpriced type contributes a count but zero revenue).
  // DISTINCT ON the record so a type with more than one active priced `xray`
  // service still contributes exactly one price per capture (matching
  // resolveXrayPrice's LIMIT 1) — otherwise the join multiplies counts AND revenue.
  const rows = await db
    .selectDistinctOn([xrayRecords.id], {
      origin: xrayRecords.origin,
      amount: services.amount,
      taxStatus: services.taxStatus,
    })
    .from(xrayRecords)
    .leftJoin(
      services,
      and(
        eq(services.xrayTypeId, xrayRecords.xrayTypeId),
        eq(services.category, 'xray'),
        eq(services.isActive, true),
        eq(services.status, 'active')
      )
    )
    .where(and(gte(xrayRecords.uploadedAt, dayStart), lte(xrayRecords.uploadedAt, dayEnd)))
    .orderBy(xrayRecords.id, asc(services.createdAt))

  let internalCount = 0
  let externalCount = 0
  let revenue = Money.zero()
  let tax = Money.zero()
  const stdRate = await standardRatePct(db)

  for (const r of rows) {
    if (r.origin === 'external') externalCount++
    else internalCount++
    if (r.amount == null) continue
    const net = Money.from(Number(r.amount))
    revenue = revenue.add(net)
    if ((r.taxStatus ?? 'exempt') === 'standard') tax = tax.add(net.percent(stdRate))
  }

  // X-ray expense-category spend posted today (admin-creatable category, matched
  // by name; mirrors the §9.7 "X-ray expense category" target).
  const [exp] = await db
    .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
    .from(expenses)
    .where(
      and(
        eq(expenses.status, 'paid'),
        gte(expenses.date, dayStart),
        lte(expenses.date, dayEnd),
        sql`(lower(${expenses.category}) LIKE ${XRAY_EXPENSE_MATCH} OR lower(${expenses.category}) LIKE ${IMAGING_EXPENSE_MATCH})`
      )
    )
  const expenseTotal = Money.from(Number(exp?.total ?? 0))

  const total = internalCount + externalCount
  if (total === 0 && expenseTotal.isZero()) return null

  return {
    module: 'xrays',
    title: 'X-rays',
    metrics: [
      { label: 'Total', value: total },
      { label: 'Internal', value: internalCount },
      { label: 'External', value: externalCount },
      { label: 'Revenue', value: ghs(revenue) },
      { label: 'Tax', value: ghs(tax) },
      { label: 'Expenses', value: ghs(expenseTotal) },
    ],
  }
}
