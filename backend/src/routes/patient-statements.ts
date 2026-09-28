// Patient statements (M2.2) — persisted PDF statements per patient.
//
// Endpoints:
//   GET  /patient/:patientId             → list statements for a patient
//   POST /patient/:patientId             → generate + upload + persist (sync)
//   GET  /:statementId/download          → 302 → DO Spaces CDN URL
//
// RBAC: MODULES.PAYMENTS — READ for list/download, CREATE for generate.

import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  invoices,
  patientStatements,
  patients,
  paymentPlans,
  payments,
  user,
  walletTransactions,
} from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { getBranding } from '../lib/branding'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { renderHtmlToPdf } from '../lib/pdf-render'
import { checkPermission, getCurrentUser, isAdmin } from '../lib/rbac'
import { renderStatementHtml, type StatementEntry } from '../lib/statement-html'
import {
  deleteFromCategory,
  getSignedDownloadUrlForCategory,
  uploadToCategory,
} from '../lib/storage-router'
import type { HonoEnv } from '../lib/types'

const patientStatementsApp = new Hono<HonoEnv>()

const MODULE = MODULES.PAYMENTS

// ── Helpers ──────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function buildStatementKey(patientId: string, now: Date): string {
  const ts =
    `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-` +
    `${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`
  // Lives alongside the patient's photos/documents under `patients/<id>/...` so
  // every file generated for a patient sits in one folder in object storage.
  return `patients/${patientId}/statements/statement-${ts}.pdf`
}

async function loadClinicInfo(): Promise<{
  name: string
  phone: string | null
  address: string | null
}> {
  // Branding integration is the single source of truth — see Integrations
  // → Branding in the portal. The retired `clinic_info` KV is no longer read.
  const branding = await getBranding()
  return {
    name: branding.name,
    phone: branding.phones?.[0] ?? null,
    address: branding.address ?? null,
  }
}

// Build the windowed statement rows PLUS the authoritative current amount due.
//
// `amountDue` is the same figure the ledger / patient profile shows — the sum of
// the remaining balance on outstanding invoices — NOT a cash-basis running total.
// The two diverge (per-invoice overpayments clamp at 0; wallet round-trips), so
// the statement must anchor to this number rather than derive it from the rows.
export async function buildLedgerEntries(
  db: ReturnType<typeof getDb>,
  patientId: string,
  fromDate: Date,
  toDate: Date
): Promise<{ entries: StatementEntry[]; amountDue: number }> {
  const [patientInvoices, patientPayments, patientWalletTxns, patientPlans] = await Promise.all([
    db.query.invoices.findMany({
      where: eq(invoices.patientId, patientId),
      orderBy: [desc(invoices.createdAt)],
    }),
    db.query.payments.findMany({
      where: eq(payments.patientId, patientId),
      orderBy: [desc(payments.createdAt)],
    }),
    db.query.walletTransactions.findMany({
      where: eq(walletTransactions.patientId, patientId),
      orderBy: [desc(walletTransactions.createdAt)],
    }),
    db.select().from(paymentPlans).where(eq(paymentPlans.patientId, patientId)),
  ])

  const planById = new Map(patientPlans.map((p) => [p.id, p]))

  type Kind = 'payment' | 'charge' | 'wallet_credit' | 'wallet_debit'

  interface Staged {
    at: string
    kind: Kind
    description: string
    amount: number
  }

  // `numeric` columns come back from the pg driver as STRINGS despite the
  // `.$type<number>()` annotation. Coerce every amount to a real number here —
  // otherwise the running-balance `+=` below does string concatenation and the
  // balance column ends up NaN.
  const num = (v: unknown): number => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  /** Integer CENTS in — statement amounts are money columns. */
  const fmtGhs = (cents: number): string => {
    const [whole, frac = '00'] = (Math.abs(cents) / 100).toFixed(2).split('.')
    return `GHS ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`
  }

  // A payment-plan is billed as ONE `plan_total` master invoice; the per-
  // installment child invoices are voided + archived (superseded) and must be
  // excluded from the statement, otherwise the plan is double-counted. Give the
  // master a plain-English description that spells out the total + schedule so
  // the patient understands the single charge covers the whole plan.
  const describeInvoice = (inv: (typeof patientInvoices)[number]): string => {
    if (inv.type === 'plan_total') {
      const plan = inv.planId ? planById.get(inv.planId) : undefined
      const n = plan?.numberOfInstallments ?? null
      const per = plan?.amountPerInstallment != null ? num(plan.amountPerInstallment) : null
      if (n && per) return `Treatment plan total — ${n} installments of ${fmtGhs(per)}`
      return inv.description || `Treatment plan total (${inv.invoiceNumber})`
    }
    return inv.description || `Invoice ${inv.invoiceNumber}`
  }

  const staged: Staged[] = [
    ...patientPayments.map<Staged>((p) => ({
      at: p.createdAt.toISOString(),
      kind: 'payment',
      description: p.description ?? `Payment — ${p.method}`,
      amount: -Math.abs(num(p.amount)),
    })),
    // Exclude archived / void / written-off / draft invoices — matches the
    // on-screen ledger (patients.ts) and drops the superseded installment rows.
    ...patientInvoices
      .filter(
        (inv) =>
          !inv.archived &&
          inv.status !== 'void' &&
          inv.status !== 'written_off' &&
          inv.status !== 'draft'
      )
      .map<Staged>((inv) => ({
        at: inv.createdAt.toISOString(),
        kind: 'charge',
        description: describeInvoice(inv),
        amount: num(inv.amount),
      })),
    ...patientWalletTxns.map<Staged>((wt) => ({
      at: wt.createdAt.toISOString(),
      kind: wt.type === 'credit' ? 'wallet_credit' : 'wallet_debit',
      description: wt.description,
      amount: wt.type === 'credit' ? num(wt.amount) : -num(wt.amount),
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  let outstanding = 0
  // Patient-facing labels — plainer than the internal kind names.
  const kindLabel: Record<Kind, string> = {
    payment: 'Payment received',
    charge: 'Invoice / Charge',
    wallet_credit: 'Wallet credit',
    wallet_debit: 'Wallet applied',
  }
  // A charge adds to what the patient owes (debit, red −); everything else is in
  // the patient's favour (credit, green +).
  const kindDirection: Record<Kind, 'credit' | 'debit'> = {
    payment: 'credit',
    charge: 'debit',
    wallet_credit: 'credit',
    wallet_debit: 'credit',
  }

  const forward: StatementEntry[] = staged.map((e) => {
    switch (e.kind) {
      case 'charge':
      case 'payment':
        outstanding += e.amount
        break
      case 'wallet_debit':
        outstanding -= Math.abs(e.amount)
        break
      case 'wallet_credit':
        // wallet credits don't move outstanding
        break
    }
    return {
      at: e.at,
      type: kindLabel[e.kind],
      description: e.description,
      amount: e.amount,
      balanceAfter: outstanding,
      direction: kindDirection[e.kind],
    }
  })

  // Authoritative amount due — Σ remaining balance of outstanding invoices,
  // clamped ≥ 0 per invoice (mirrors GET /:patientId/ledger). Independent of the
  // statement window: it's the balance owed *now*.
  const OUTSTANDING_STATUSES = ['issued', 'partially_paid', 'pending', 'partial', 'overdue']
  const remainingOf = (inv: (typeof patientInvoices)[number]): number =>
    inv.balance != null ? num(inv.balance) : num(inv.amount) - num(inv.paidAmount)
  const amountDue = patientInvoices
    .filter((inv) => !inv.archived && OUTSTANDING_STATUSES.includes(inv.status))
    .reduce((sum, inv) => sum + Math.max(0, remainingOf(inv)), 0)

  // Inclusive window — include anything on fromDate 00:00 up to toDate 23:59:59.999.
  const fromMs = fromDate.getTime()
  const toMs = toDate.getTime()
  const entries = forward.filter((e) => {
    const t = new Date(e.at).getTime()
    return t >= fromMs && t <= toMs
  })

  return { entries, amountDue }
}

// ── GET /patient/:patientId — list statements ────────────────────────────────

patientStatementsApp.get('/patient/:patientId', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, currentUser.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const patientId = c.req.param('patientId')
  try {
    const db = getDb(process.env.DATABASE_URL!)

    const patient = await db.query.patients.findFirst({ where: eq(patients.id, patientId) })
    if (!patient) return c.json({ error: 'Patient not found' }, 404)

    const rows = await db
      .select({
        id: patientStatements.id,
        patientId: patientStatements.patientId,
        fromDate: patientStatements.fromDate,
        toDate: patientStatements.toDate,
        fileKey: patientStatements.fileKey,
        generatedBy: patientStatements.generatedBy,
        generatedAt: patientStatements.generatedAt,
        sizeBytes: patientStatements.sizeBytes,
        createdAt: patientStatements.createdAt,
        generatedByName: user.name,
      })
      .from(patientStatements)
      .leftJoin(user, eq(patientStatements.generatedBy, user.id))
      .where(eq(patientStatements.patientId, patientId))
      .orderBy(desc(patientStatements.generatedAt))

    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error))
    logError(err, { userId: currentUser.id, patientId, action: 'list_patient_statements' })
    return c.json({ error: 'Failed to fetch patient statements' }, 500)
  }
})

// ── POST /patient/:patientId — generate statement ────────────────────────────

patientStatementsApp.post('/patient/:patientId', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, currentUser.id, MODULE as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const patientId = c.req.param('patientId')

  let body: { fromDate?: string; toDate?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.fromDate || !body.toDate) {
    return c.json({ error: 'fromDate and toDate are required (ISO 8601)' }, 400)
  }

  const fromDate = new Date(body.fromDate)
  const toDate = new Date(body.toDate)
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return c.json({ error: 'Invalid date format — expected ISO 8601' }, 400)
  }

  if (fromDate.getTime() > toDate.getTime()) {
    return c.json({ error: 'fromDate must be on or before toDate' }, 400)
  }

  // Expand toDate to end-of-day so same-day ranges include the whole day.
  const toDateInclusive = new Date(toDate)
  toDateInclusive.setHours(23, 59, 59, 999)

  try {
    const db = getDb(process.env.DATABASE_URL!)

    const patient = await db.query.patients.findFirst({ where: eq(patients.id, patientId) })
    if (!patient) return c.json({ error: 'Patient not found' }, 404)

    const clinic = await loadClinicInfo()
    const { entries, amountDue } = await buildLedgerEntries(
      db,
      patientId,
      fromDate,
      toDateInclusive
    )

    const generatedAt = new Date()
    // Server-rendered via headless Chromium (HTML → PDF) — see statement-html.ts.
    const statementHtml = renderStatementHtml({
      clinicName: clinic.name,
      clinicPhone: clinic.phone,
      clinicAddress: clinic.address,
      patientName: patient.name,
      patientIdDisplay: patient.patientId ?? null,
      fromDate,
      toDate: toDateInclusive,
      entries,
      amountDue,
      generatedAt,
      generatedByName: currentUser.name ?? currentUser.email ?? 'Unknown',
    })
    const pdfBuffer = await renderHtmlToPdf(statementHtml)

    const key = buildStatementKey(patientId, generatedAt)
    let uploadResult: { url: string }
    try {
      uploadResult = await uploadToCategory(
        'patient_records',
        key,
        Buffer.from(pdfBuffer),
        'application/pdf'
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Storage provider not configured'
      return c.json({ error: msg }, 500)
    }

    const [inserted] = await db
      .insert(patientStatements)
      .values({
        patientId,
        fromDate,
        toDate: toDateInclusive,
        fileKey: key,
        generatedBy: currentUser.id,
        generatedAt,
        sizeBytes: pdfBuffer.byteLength,
      })
      .returning()

    // Audit log — explicit call (not via diff helper) per spec.
    await createAuditLog(db, {
      userId: currentUser.id,
      action: 'create',
      module: MODULES.PAYMENTS,
      entityId: inserted.id,
      entityName: `Statement for ${patient.name}`,
      changes: {
        fromDate: fromDate.toISOString(),
        toDate: toDateInclusive.toISOString(),
        fileKey: key,
        sizeBytes: pdfBuffer.byteLength,
      },
    })

    return c.json({
      success: true,
      data: {
        ...inserted,
        downloadUrl: uploadResult.url,
      },
    })
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error))
    logError(err, { userId: currentUser.id, patientId, action: 'generate_patient_statement' })
    return c.json({ error: 'Failed to generate statement' }, 500)
  }
})

// ── GET /:statementId/download — redirect to the CDN URL ────────────────────

patientStatementsApp.get('/:statementId/download', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, currentUser.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const statementId = c.req.param('statementId')

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const [row] = await db
      .select()
      .from(patientStatements)
      .where(eq(patientStatements.id, statementId))
      .limit(1)

    if (!row) return c.json({ error: 'Statement not found' }, 404)

    // Patient statements are private PHI — never a permanent public URL. Mint a
    // short-lived presigned GET (5-min TTL) so the browser can open + print the
    // PDF inline, then the link dies.
    let url: string
    try {
      url = await getSignedDownloadUrlForCategory('patient_records', row.fileKey, {
        expiresIn: 300,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Storage provider not configured'
      return c.json({ error: msg }, 500)
    }
    // `?format=json` returns the presigned URL as JSON so the SPA can fetch it
    // through the authenticated api-client (which sends X-App-Id) and then
    // window.open() it. A plain <a href> navigation to this endpoint can't carry
    // X-App-Id (or a Referer, when the link is rel="noreferrer"), so it would
    // 401. Default remains a 302 redirect for any direct/bookmarked use.
    if (c.req.query('format') === 'json') {
      return c.json({ success: true, data: { url } })
    }
    return c.redirect(url, 302)
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error))
    logError(err, { userId: currentUser.id, statementId, action: 'download_patient_statement' })
    return c.json({ error: 'Failed to load statement' }, 500)
  }
})

// ── DELETE /:statementId — admin-only: remove a statement + its stored PDF ────

patientStatementsApp.delete('/:statementId', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)

  // Statements are financial PHI records — restrict deletion to admins.
  if (!(await isAdmin(c, currentUser.id))) {
    return c.json({ error: 'Admin only' }, 403)
  }

  const statementId = c.req.param('statementId')

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const [row] = await db
      .select()
      .from(patientStatements)
      .where(eq(patientStatements.id, statementId))
      .limit(1)

    if (!row) return c.json({ error: 'Statement not found' }, 404)

    // Best-effort delete of the stored object; proceed with the DB delete even if
    // storage cleanup fails (a dangling object is preferable to a dangling record
    // the admin can no longer act on).
    try {
      await deleteFromCategory('patient_records', row.fileKey)
    } catch (err) {
      logError(err, { userId: currentUser.id, statementId, action: 'delete_statement_object' })
    }

    await db.delete(patientStatements).where(eq(patientStatements.id, statementId))

    await createAuditLog(db, {
      userId: currentUser.id,
      action: 'delete',
      module: MODULES.PAYMENTS,
      entityId: statementId,
      entityName: 'Patient statement',
      changes: {
        patientId: row.patientId,
        fromDate: row.fromDate?.toISOString?.() ?? String(row.fromDate),
        toDate: row.toDate?.toISOString?.() ?? String(row.toDate),
        fileKey: row.fileKey,
      },
    })

    return c.json({ success: true })
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error))
    logError(err, { userId: currentUser.id, statementId, action: 'delete_patient_statement' })
    return c.json({ error: 'Failed to delete statement' }, 500)
  }
})

export { patientStatementsApp }
