/**
 * Patient-tag query helpers — admin-v1 §2.7.
 *
 * The legacy `patients.isOrtho` boolean and `patients.type` text columns are being
 * retired in favour of the `patient_tags` / `patient_tag_links` junction. READ
 * consumers must derive membership ("does this patient carry tag X?") from the
 * junction rather than the old columns.
 *
 * Canonical tag names used by migrated consumers:
 *   - 'Ortho'    — replaces isOrtho=true / type='ortho'
 *   - 'External' — replaces type='external'
 *   - default/general (neither tag) — replaces type='general'
 *
 * These helpers emit a correlated EXISTS subquery against the junction so callers
 * can compose them into WHERE clauses, SELECT booleans, or GROUP BY keys without
 * adding a JOIN that would fan out row counts.
 */

import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm'
import type { getDb } from '../db'
import { patientTagLinks, patientTags } from '../db/schema'

/** @deprecated Display name. Match on ORTHO_TAG_KEY instead — names are renameable. */
export const ORTHO_TAG = 'Ortho'
/** Stable system key for the Ortho tag. */
export const ORTHO_TAG_KEY = 'ortho'
/** 'External' has no system key yet, so it is still matched by name. */
export const EXTERNAL_TAG = 'External'

/**
 * EXISTS subquery: true when the patient identified by `patientIdCol` is linked to
 * a tag whose name equals `tagName`.
 *
 * @param patientIdCol  A SQL fragment that resolves to the patient id in the outer
 *                      query, e.g. `patients.id` (a Drizzle column) or
 *                      `sql\`p.id\`` for a raw-SQL outer query.
 */
export function hasPatientTag(patientIdCol: unknown, tagName: string): SQL<boolean> {
  return sql<boolean>`EXISTS (
    SELECT 1
    FROM ${patientTagLinks} ptl
    JOIN ${patientTags} pt ON pt.id = ptl."tagId"
    WHERE ptl."patientId" = ${patientIdCol}
      AND pt.name = ${tagName}
  )`
}

/**
 * EXISTS subquery keyed on the stable `systemKey` rather than the display name.
 * Prefer this for any tag that has one — an admin renaming the tag in Settings
 * must not silently switch the behaviour off.
 */
export function hasPatientTagByKey(patientIdCol: unknown, systemKey: string): SQL<boolean> {
  return sql<boolean>`EXISTS (
    SELECT 1
    FROM ${patientTagLinks} ptl
    JOIN ${patientTags} pt ON pt.id = ptl."tagId"
    WHERE ptl."patientId" = ${patientIdCol}
      AND pt."systemKey" = ${systemKey}
  )`
}

/**
 * Convenience: EXISTS subquery for the Ortho tag.
 *
 * Keyed on `systemKey = 'ortho'` (0206). It previously matched `name = 'Ortho'`
 * case-sensitively, so a lowercase or renamed tag read as "not ortho".
 */
export function hasOrthoTag(patientIdCol: unknown): SQL<boolean> {
  return hasPatientTagByKey(patientIdCol, ORTHO_TAG_KEY)
}

/** Convenience: EXISTS subquery for the canonical 'External' tag. */
export function hasExternalTag(patientIdCol: unknown): SQL<boolean> {
  return hasPatientTag(patientIdCol, EXTERNAL_TAG)
}

/**
 * Runtime check for an already-loaded patient row: does this patient carry `tagName`?
 * Issues a single EXISTS query. Use when you have a patient id but not a query to
 * compose into (e.g. building a response payload).
 */
export async function patientHasTag(
  db: ReturnType<typeof getDb>,
  patientId: string,
  tagName: string
): Promise<boolean> {
  const res = await db.execute(sql`SELECT ${hasPatientTag(sql`${patientId}`, tagName)} AS has`)
  return Boolean((res.rows[0] as { has?: unknown } | undefined)?.has)
}

/** As `patientHasTag`, but matched on the stable system key. */
export async function patientHasTagByKey(
  db: ReturnType<typeof getDb>,
  patientId: string,
  systemKey: string
): Promise<boolean> {
  const res = await db.execute(
    sql`SELECT ${hasPatientTagByKey(sql`${patientId}`, systemKey)} AS has`
  )
  return Boolean((res.rows[0] as { has?: unknown } | undefined)?.has)
}

/** Convenience: is this patient orthodontic? Keyed on `systemKey`, not the name. */
export async function patientIsOrtho(
  db: ReturnType<typeof getDb>,
  patientId: string
): Promise<boolean> {
  return patientHasTagByKey(db, patientId, ORTHO_TAG_KEY)
}

/**
 * Bulk tag classification for an already-fetched set of patient ids. Returns the
 * subsets carrying the 'Ortho' / 'External' tags via ONE flat junction query —
 * use this instead of selecting correlated EXISTS columns alongside a whole-table
 * `row: patients` select (that form trips Postgres 42702 ambiguity). Callers
 * classify their rows in-memory against the returned sets.
 */
export async function partitionByTags(
  db: ReturnType<typeof getDb>,
  patientIds: string[]
): Promise<{ ortho: Set<string>; external: Set<string> }> {
  const ortho = new Set<string>()
  const external = new Set<string>()
  if (patientIds.length === 0) return { ortho, external }
  // Ortho is matched on its system key; 'External' has no key yet, so it is
  // still matched by name. Both are pulled in one pass with an OR.
  const rows = await db
    .select({
      patientId: patientTagLinks.patientId,
      name: patientTags.name,
      systemKey: patientTags.systemKey,
    })
    .from(patientTagLinks)
    .innerJoin(patientTags, eq(patientTags.id, patientTagLinks.tagId))
    .where(
      and(
        inArray(patientTagLinks.patientId, patientIds),
        or(eq(patientTags.systemKey, ORTHO_TAG_KEY), eq(patientTags.name, EXTERNAL_TAG))
      )
    )
  for (const r of rows) {
    if (r.systemKey === ORTHO_TAG_KEY) ortho.add(r.patientId)
    else if (r.name === EXTERNAL_TAG) external.add(r.patientId)
  }
  return { ortho, external }
}
