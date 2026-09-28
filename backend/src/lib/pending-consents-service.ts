/**
 * pending-consents-service.ts — admin-v1 §18.2.
 *
 * "Consent due" tracking: required consent forms a patient has NOT yet signed
 * before a procedure. The tracker (§18.6) already surfaces *signed* consents;
 * this is the inverse — what is still outstanding.
 *
 * "Required" is modelled as the set of **active templates that require a
 * signature** (`active = true AND requiresSignature = true`). There is no
 * per-procedure required-consent linkage in the schema, so the clinic's active
 * signature-bearing templates are the baseline "must be signed before a
 * procedure" set. `pending = required − already-signed` per patient.
 *
 * By default the scope is patients with an **upcoming appointment** (the
 * "before a procedure" framing). A single `patientId` can be passed to scope to
 * one patient (e.g. a pre-procedure check on a chart).
 *
 * The §18.3 digest surfaces the count via `countPendingConsents`.
 */

import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { appointments, consentFormTemplates, patients, signedConsentForms } from '../db/schema'

/** Appointment statuses that count as "upcoming" (a procedure still ahead). */
const UPCOMING_STATUSES = ['scheduled', 'confirmed', 'checked_in', 'in_chair'] as const

export interface PendingConsentTemplate {
  templateId: string
  templateName: string
  category: string | null
  requiresWitness: boolean
}

export interface PendingConsentPatient {
  patientId: string
  patientName: string
  /** Earliest upcoming appointment date for this patient, if scoped that way. */
  nextAppointmentDate: Date | null
  pending: PendingConsentTemplate[]
}

export interface GetPendingConsentsOptions {
  /** Limit to a single patient (ignores the upcoming-appointment scope). */
  patientId?: string
  /**
   * When true (default), scope to patients with an upcoming appointment.
   * When false (and no `patientId`), scope to every patient — heavy; intended
   * for explicit "all outstanding" reporting only.
   */
  upcomingOnly?: boolean
}

/**
 * The active, signature-bearing consent templates that are "required" before a
 * procedure. The baseline every in-scope patient is measured against.
 */
async function getRequiredTemplates(db: DB): Promise<PendingConsentTemplate[]> {
  const rows = await db
    .select({
      templateId: consentFormTemplates.id,
      templateName: consentFormTemplates.name,
      category: consentFormTemplates.category,
      requiresWitness: consentFormTemplates.requiresWitness,
    })
    .from(consentFormTemplates)
    .where(
      and(eq(consentFormTemplates.active, true), eq(consentFormTemplates.requiresSignature, true))
    )
  return rows
}

/**
 * Patients in scope: either a single explicit patient, or every patient with an
 * upcoming appointment. Returns each patient's earliest upcoming appointment
 * date (null when scoped by `patientId` without the appointment join).
 */
async function getScopedPatients(
  db: DB,
  opts: GetPendingConsentsOptions
): Promise<{ patientId: string; patientName: string; nextAppointmentDate: Date | null }[]> {
  if (opts.patientId) {
    const rows = await db
      .select({ patientId: patients.id, patientName: patients.name })
      .from(patients)
      .where(eq(patients.id, opts.patientId))
    return rows.map((r) => ({ ...r, nextAppointmentDate: null }))
  }

  const upcomingOnly = opts.upcomingOnly ?? true
  if (!upcomingOnly) {
    const rows = await db
      .select({ patientId: patients.id, patientName: patients.name })
      .from(patients)
    return rows.map((r) => ({ ...r, nextAppointmentDate: null }))
  }

  // Patients with at least one upcoming appointment; earliest such date.
  const rows = await db
    .select({
      patientId: patients.id,
      patientName: patients.name,
      nextAppointmentDate: sql<Date>`MIN(${appointments.date})`,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(
      and(
        gt(appointments.date, new Date()),
        inArray(appointments.status, UPCOMING_STATUSES as unknown as string[])
      )
    )
    .groupBy(patients.id, patients.name)
  return rows
}

/**
 * Required consent forms each in-scope patient has NOT yet signed. Patients
 * with nothing pending are omitted.
 */
export async function getPendingConsents(
  db: DB,
  opts: GetPendingConsentsOptions = {}
): Promise<PendingConsentPatient[]> {
  const required = await getRequiredTemplates(db)
  if (required.length === 0) return []

  const scoped = await getScopedPatients(db, opts)
  if (scoped.length === 0) return []

  const patientIds = scoped.map((p) => p.patientId)
  const requiredTemplateIds = required.map((t) => t.templateId)

  // Which (patient, template) pairs are already signed — across the in-scope
  // patients and the required templates only.
  const signed = await db
    .select({
      patientId: signedConsentForms.patientId,
      templateId: signedConsentForms.templateId,
    })
    .from(signedConsentForms)
    .where(
      and(
        inArray(signedConsentForms.patientId, patientIds),
        inArray(signedConsentForms.templateId, requiredTemplateIds)
      )
    )

  const signedKey = (patientId: string, templateId: string) => `${patientId}::${templateId}`
  const signedSet = new Set(signed.map((s) => signedKey(s.patientId, s.templateId)))

  const out: PendingConsentPatient[] = []
  for (const p of scoped) {
    const pending = required.filter((t) => !signedSet.has(signedKey(p.patientId, t.templateId)))
    if (pending.length === 0) continue
    out.push({
      patientId: p.patientId,
      patientName: p.patientName,
      nextAppointmentDate: p.nextAppointmentDate,
      pending,
    })
  }
  return out
}

/**
 * Total count of outstanding (patient × required-template) consent pairs across
 * the in-scope patients — the number the §18.3 digest surfaces.
 */
export async function countPendingConsents(
  db: DB,
  opts: GetPendingConsentsOptions = {}
): Promise<number> {
  const rows = await getPendingConsents(db, opts)
  return rows.reduce((sum, r) => sum + r.pending.length, 0)
}
