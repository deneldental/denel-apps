/**
 * Patient auto-tagging — admin-v1 §2.7 (EXPAND half).
 *
 * Treatment-derived tags replace the old `isOrtho` boolean / `type` column.
 * When a clinical event happens (an ortho case/stage is saved, an insurance
 * patient is recorded, …) we apply the matching `patient_tags` row to the
 * patient. Tags are ADDITIVE — auto-tagging never removes a tag.
 *
 * Idempotent: every link insert is `ON CONFLICT (patientId, tagId) DO NOTHING`
 * against the `patient_tag_links_uniq` index, so re-firing the same event is a
 * no-op.
 *
 * Structured so more rules can be added: each rule is just "resolve a tag id by
 * name, then link it". `applyTagByName` is the single primitive; the named
 * helpers (`applyOrthoTag`, `applyPediatricTag`, …) and the
 * `TREATMENT_TAG_RULES` map build on it.
 */

import { eq } from 'drizzle-orm'
import type { DB } from '../db'
import { patientTagLinks, patientTags } from '../db/schema'

/** Canonical tag names this service knows how to apply. */
export const AUTO_TAG_NAMES = {
  ORTHO: 'Ortho',
  PEDIATRIC: 'Pediatric',
  EXTERNAL: 'External',
  INSURANCE: 'Insurance',
} as const

/**
 * Maps a treatment / clinical signal → the tag name to apply. Add new
 * treatment-derived rules here (e.g. a service category → 'Implant').
 */
export const TREATMENT_TAG_RULES: Record<string, string> = {
  ortho: AUTO_TAG_NAMES.ORTHO,
  ortho_review: AUTO_TAG_NAMES.ORTHO,
}

/**
 * Resolve a tag id by its (unique) name. Returns `null` when the tag has not
 * been seeded — callers treat a missing tag as a no-op rather than an error so
 * a stale environment never blocks a clinical write.
 */
export async function tagIdByName(db: DB, name: string): Promise<string | null> {
  const [row] = await db
    .select({ id: patientTags.id })
    .from(patientTags)
    .where(eq(patientTags.name, name))
    .limit(1)
  return row?.id ?? null
}

/**
 * Link a tag (by name) to a patient. Idempotent + tolerant of a missing tag.
 * Returns true when a link now exists (created or already present), false when
 * the tag name isn't seeded.
 */
export async function applyTagByName(
  db: DB,
  patientId: string,
  tagName: string,
  assignedById?: string | null
): Promise<boolean> {
  const tagId = await tagIdByName(db, tagName)
  if (!tagId) return false
  await applyTagById(db, patientId, tagId, assignedById)
  return true
}

/** Link a tag (by id) to a patient. Idempotent against the uniq index. */
export async function applyTagById(
  db: DB,
  patientId: string,
  tagId: string,
  assignedById?: string | null
): Promise<void> {
  await db
    .insert(patientTagLinks)
    .values({ patientId, tagId, assignedById: assignedById ?? null })
    .onConflictDoNothing()
}

/** Apply the 'Ortho' tag — replaces the old `isOrtho = true` semantics. */
export function applyOrthoTag(
  db: DB,
  patientId: string,
  assignedById?: string | null
): Promise<boolean> {
  return applyTagByName(db, patientId, AUTO_TAG_NAMES.ORTHO, assignedById)
}

/** Apply the 'Pediatric' tag — driven by the structural `isChild` flag. */
export function applyPediatricTag(
  db: DB,
  patientId: string,
  assignedById?: string | null
): Promise<boolean> {
  return applyTagByName(db, patientId, AUTO_TAG_NAMES.PEDIATRIC, assignedById)
}

/**
 * Treatment → tag mapper. Given a clinical signal (a stage type or a treatment
 * keyword), apply the mapped tag if a rule exists. Unknown signals are a no-op.
 * This is the extension point for future treatment-derived tags.
 */
export async function applyTreatmentTag(
  db: DB,
  patientId: string,
  signal: string,
  assignedById?: string | null
): Promise<boolean> {
  const tagName = TREATMENT_TAG_RULES[signal]
  if (!tagName) return false
  return applyTagByName(db, patientId, tagName, assignedById)
}
