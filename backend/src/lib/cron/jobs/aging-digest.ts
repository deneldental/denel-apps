/**
 * Daily aging-report digest email.
 *
 * Recipients: every non-banned user whose resolved RBAC permissions include
 *   `financial_records:read` (admin's wildcard auto-qualifies).
 * Content: AR aging bucket summary (current / 31-60 / 61-90 / 90+) plus the
 *   top 10 patient debtors by total outstanding.
 *
 * Weekends are skipped — finance review tends to happen Mon-Fri and the
 * email is noise on Sat/Sun.
 */

import { inArray } from 'drizzle-orm'
import { env } from '../../../config/env'
import { getDb } from '../../../db'
import { invoices, patients, user as userTable } from '../../../db/schema'
import { resolveUserPermissions } from '../../../rbac/engine/BundleResolver'
import { assignBucket } from '../../aging'
import { sendEmail } from '../../email'
import type { JobContext, JobRunResult } from '../types'

export async function runAgingDigest(ctx: JobContext): Promise<JobRunResult> {
  const dow = new Date().getDay()
  if (dow === 0 || dow === 6) {
    return { summary: 'skipped weekend' }
  }

  const db = getDb(env.DATABASE_URL)

  // 1. Recipients: every non-banned user whose perms include financial_records:read.
  const candidates = await db
    .select({
      id: userTable.id,
      email: userTable.email,
      name: userTable.name,
      roleId: userTable.roleId,
    })
    .from(userTable)
    .where(inArray(userTable.banned, [false]))
  const recipients: Array<{ id: string; email: string; name: string }> = []
  for (const u of candidates) {
    if (!u.email) continue
    const perms = await resolveUserPermissions(db as any, u.id, u.roleId)
    const covered = perms.some(
      (p) =>
        (p.module === '*' || p.module === 'financial_records') &&
        (p.action === '*' || p.action === 'read')
    )
    if (covered) recipients.push(u)
  }
  if (recipients.length === 0) {
    return { summary: 'no recipients with financial_records:read' }
  }

  // 2. Compute aging buckets (same logic as /api/aging-report).
  const outstanding = await db
    .select()
    .from(invoices)
    .where(inArray(invoices.status, ['pending', 'partial', 'overdue']))

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  type Row = {
    patientId: string
    current: number
    bucket30: number
    bucket60: number
    bucket90: number
    total: number
  }
  const perPatient = new Map<string, Row>()

  for (const inv of outstanding) {
    if (!inv.patientId) continue
    const balance = (inv.amount ?? 0) - (inv.paidAmount ?? 0)
    if (balance <= 0) continue
    const due = inv.dueDate ? new Date(inv.dueDate) : null
    let row = perPatient.get(inv.patientId)
    if (!row) {
      row = {
        patientId: inv.patientId,
        current: 0,
        bucket30: 0,
        bucket60: 0,
        bucket90: 0,
        total: 0,
      }
      perPatient.set(inv.patientId, row)
    }
    const bucket = assignBucket(due, today) as 'current' | 'bucket30' | 'bucket60' | 'bucket90'
    row[bucket] += balance
    row.total += balance
  }

  const summary = Array.from(perPatient.values()).reduce(
    (acc, row) => ({
      current: acc.current + row.current,
      bucket30: acc.bucket30 + row.bucket30,
      bucket60: acc.bucket60 + row.bucket60,
      bucket90: acc.bucket90 + row.bucket90,
      total: acc.total + row.total,
    }),
    { current: 0, bucket30: 0, bucket60: 0, bucket90: 0, total: 0 }
  )

  // 3. Top 10 debtors with patient names for the table.
  const topRows = Array.from(perPatient.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
  const topPatientIds = topRows.map((r) => r.patientId)
  const namesById = new Map<string, string>()
  if (topPatientIds.length > 0) {
    const ps = await db
      .select({ id: patients.id, name: patients.name })
      .from(patients)
      .where(inArray(patients.id, topPatientIds))
    for (const p of ps) namesById.set(p.id, p.name)
  }

  // 4. Build HTML + send.
  const html = renderHtml(summary, topRows, namesById, perPatient.size)
  const subject = `Denel AR — ${ghs(summary.total)} outstanding · ${perPatient.size} patients`

  let sentCount = 0
  for (const r of recipients) {
    try {
      await sendEmail(
        { RESEND_API_KEY: process.env.RESEND_API_KEY ?? '', DATABASE_URL: env.DATABASE_URL },
        [{ to: r.email, subject, html }],
        undefined,
        'custom'
      )
      sentCount++
    } catch (err) {
      ctx.log('email send failed', { to: r.email, err: (err as Error).message })
    }
  }

  return {
    summary: `sent to ${sentCount}/${recipients.length}; total ${ghs(summary.total)} across ${perPatient.size} patients`,
    details: {
      sent: sentCount,
      recipientCount: recipients.length,
      summary,
      patientCount: perPatient.size,
    },
  }
}

/** Integer CENTS in — every amount on this digest is a cent count. */
function ghs(cents: number): string {
  return `GHS ${(cents / 100).toFixed(2)}`
}

function renderHtml(
  s: { current: number; bucket30: number; bucket60: number; bucket90: number; total: number },
  topRows: Array<{
    patientId: string
    total: number
    current: number
    bucket30: number
    bucket60: number
    bucket90: number
  }>,
  namesById: Map<string, string>,
  patientCount: number
): string {
  const buckets = `
    <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;margin:12px 0">
      <tr style="background:#f3f4f6;font-weight:600">
        <td>Current</td><td>31–60 days</td><td>61–90 days</td><td>90+ days</td><td>Total</td>
      </tr>
      <tr>
        <td>${ghs(s.current)}</td>
        <td>${ghs(s.bucket30)}</td>
        <td>${ghs(s.bucket60)}</td>
        <td style="color:${s.bucket90 > 0 ? '#dc2626' : 'inherit'}">${ghs(s.bucket90)}</td>
        <td style="font-weight:600">${ghs(s.total)}</td>
      </tr>
    </table>`
  const topRowsHtml = topRows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(namesById.get(r.patientId) ?? r.patientId)}</td>
        <td style="text-align:right">${ghs(r.total)}</td>
        <td style="text-align:right;color:${r.bucket90 > 0 ? '#dc2626' : '#6b7280'}">${ghs(r.bucket90)}</td>
      </tr>`
    )
    .join('')
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:640px;margin:0 auto;padding:16px">
      <h2 style="margin:0 0 4px 0">AR aging — ${new Date().toLocaleDateString('en-GH', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
      <p style="color:#6b7280;margin:0 0 16px 0">${patientCount} patient${patientCount === 1 ? '' : 's'} with outstanding balances</p>
      ${buckets}
      <h3 style="margin:20px 0 8px 0">Top 10 debtors</h3>
      <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">
        <tr style="background:#f3f4f6;font-weight:600">
          <td>Patient</td><td style="text-align:right">Total</td><td style="text-align:right">90+ days</td>
        </tr>
        ${topRowsHtml}
      </table>
      <p style="color:#9ca3af;margin-top:24px;font-size:12px">Automated by Denel cron · /api/aging-report for the full breakdown.</p>
    </div>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
