/**
 * Compliance renewal reminders — admin-v1 §17.2.
 *
 * The Compliance module already lets an admin configure per-document SMS
 * renewal reminders (`reminderEnabled` / `reminderMonthsBefore` /
 * `reminderPhones[]` / `reminderMessage`). This is the piece that acts on that
 * config: once a document enters its reminder window (N months before expiry)
 * we SMS the configured phones, and stamp `lastReminderSentAt` so it fires
 * once per renewal cycle. Renewing a document (pushing `dateExpired` out) moves
 * the window forward, leaving the old stamp behind it — which re-arms the next
 * reminder automatically.
 *
 * Unlike the credential/HR-document expiry reminders (which notify a specific
 * staff user and dedupe via an audit_logs row), a compliance document has no
 * associated user — so the stamp lives on the row itself.
 */

import { and, eq, isNotNull } from 'drizzle-orm'
import type { DB } from '../db'
import { complianceDocuments } from '../db/schema'
import { logError, logger } from './logger'
import { sendSMS } from './sms'
import { renderSms, resolveSmsTemplate } from './sms-templates'

const DEFAULT_REMINDER_MONTHS = 3

export interface ComplianceReminderCandidate {
  id: string
  documentName: string
  dateExpired: Date
  reminderMonthsBefore: number
  reminderPhones: string[]
  reminderMessage: string | null
}

/** `date` shifted back by `months` calendar months. */
function monthsBefore(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() - months)
  return d
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The SMS body for a renewal reminder. A custom `reminderMessage` may use the
 * `{documentName}` and `{dateExpired}` tokens (the add/edit form offers them);
 * otherwise a sensible default is built. Function replacers keep `$` in a
 * document name from being treated as a replacement pattern. Exported for tests.
 */
export function buildComplianceReminderMessage(
  doc: Pick<ComplianceReminderCandidate, 'documentName' | 'dateExpired' | 'reminderMessage'>,
  now: Date = new Date(),
  // The central `compliance:renewal` template, resolved by the caller. Used only
  // when the document has no per-document custom `reminderMessage` override.
  defaultTemplate?: string
): string {
  const expiry = formatDate(doc.dateExpired)
  const custom = doc.reminderMessage?.trim()
  if (custom) {
    return custom
      .replace(/\{documentName\}/g, () => doc.documentName)
      .replace(/\{dateExpired\}/g, () => expiry)
  }
  const days = Math.ceil((doc.dateExpired.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
  const daysLabel = `${days} day${days === 1 ? '' : 's'}`
  const tpl =
    defaultTemplate?.trim() ||
    'Renewal reminder: "{documentName}" expires {expiry} ({daysLabel}). Please arrange renewal.'
  return renderSms(tpl, { documentName: doc.documentName, expiry, daysLabel })
}

/**
 * Compliance documents whose renewal reminder is due as of `now`:
 *   - reminders enabled and at least one phone configured,
 *   - `now` is within [expiry − reminderMonthsBefore, expiry], and
 *   - we haven't already reminded this cycle (no stamp at/after the window start).
 *
 * Pure read — sends nothing. The §17.2 cron job consumes this.
 */
export async function selectComplianceDocsDueForReminder(
  db: DB,
  now: Date = new Date()
): Promise<ComplianceReminderCandidate[]> {
  const rows = await db
    .select({
      id: complianceDocuments.id,
      documentName: complianceDocuments.documentName,
      dateExpired: complianceDocuments.dateExpired,
      reminderMonthsBefore: complianceDocuments.reminderMonthsBefore,
      reminderPhones: complianceDocuments.reminderPhones,
      reminderMessage: complianceDocuments.reminderMessage,
      lastReminderSentAt: complianceDocuments.lastReminderSentAt,
    })
    .from(complianceDocuments)
    .where(
      and(eq(complianceDocuments.reminderEnabled, true), isNotNull(complianceDocuments.dateExpired))
    )

  const due: ComplianceReminderCandidate[] = []
  for (const row of rows) {
    if (!row.dateExpired) continue
    const phones = (row.reminderPhones ?? []).map((p) => p.trim()).filter(Boolean)
    if (phones.length === 0) continue
    const months = row.reminderMonthsBefore ?? DEFAULT_REMINDER_MONTHS
    const windowStart = monthsBefore(row.dateExpired, months)
    if (now < windowStart) continue // not yet in the reminder window
    if (now > row.dateExpired) continue // expired — surfaced in the page/digest, not a renewal SMS
    if (row.lastReminderSentAt && row.lastReminderSentAt >= windowStart) continue // already reminded this cycle
    due.push({
      id: row.id,
      documentName: row.documentName,
      dateExpired: row.dateExpired,
      reminderMonthsBefore: months,
      reminderPhones: phones,
      reminderMessage: row.reminderMessage,
    })
  }
  return due
}

/**
 * Send the due renewal reminders and stamp `lastReminderSentAt`. Best-effort
 * per document — a send failure leaves the stamp unset so the next run retries
 * rather than silently dropping the reminder.
 */
export async function runComplianceRenewalCheck(
  db: DB,
  now: Date = new Date()
): Promise<{ sent: number; due: number }> {
  const due = await selectComplianceDocsDueForReminder(db, now)
  const defaultTemplate = await resolveSmsTemplate(
    db,
    'compliance:renewal',
    'Renewal reminder: "{documentName}" expires {expiry} ({daysLabel}). Please arrange renewal.'
  )
  let sent = 0
  for (const doc of due) {
    const message = buildComplianceReminderMessage(doc, now, defaultTemplate)
    try {
      await sendSMS(
        doc.reminderPhones.map((phone) => ({ phone, message })),
        undefined,
        'bulk'
      )
    } catch (err) {
      logError(err, { context: `[compliance-reminders] SMS send failed for ${doc.id}` })
      continue // leave lastReminderSentAt unset → retried on the next run
    }
    await db
      .update(complianceDocuments)
      .set({ lastReminderSentAt: now, updatedAt: now })
      .where(eq(complianceDocuments.id, doc.id))
    sent++
  }
  if (sent > 0) {
    logger.info({ sent, due: due.length }, '[compliance-reminders] tick complete')
  }
  return { sent, due: due.length }
}
