/**
 * comms-consent.ts — admin-v1 §18.1. Server-side do-not-contact (DPA) enforcement
 * for every outreach send point (CRM §13.3, Compliance §17.2, reminders).
 */

import { and, eq, inArray } from 'drizzle-orm'
import type { DB } from '../db'
import { patients } from '../db/schema'

/** Of the given patient ids, the subset that may be contacted (not opted out). */
export async function getContactablePatientIds(db: DB, patientIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(patientIds.filter(Boolean))]
  if (ids.length === 0) return new Set()
  const rows = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(inArray(patients.id, ids), eq(patients.doNotContact, false)))
  return new Set(rows.map((r) => r.id))
}

/**
 * Drop opted-out patients from a recipient list. Recipients with no patientId
 * (ad-hoc numbers) are kept — the flag only governs patient records.
 */
export async function filterContactable<T extends { patientId?: string | null }>(
  db: DB,
  recipients: T[]
): Promise<T[]> {
  const ids = recipients.map((r) => r.patientId).filter((x): x is string => !!x)
  if (ids.length === 0) return recipients
  const ok = await getContactablePatientIds(db, ids)
  return recipients.filter((r) => !r.patientId || ok.has(r.patientId))
}
