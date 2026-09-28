/**
 * Resolving an employment type to its behaviour.
 *
 * Employment type became admin-managed data in migration 0178: HR can add
 * "Locum (6 months)" without a deploy. But it still drives behaviour —
 * `isExternalTrainer` is derived from it, and only fixed-term staff have a
 * contract end date — so code can never key off the value itself, only off the
 * row's fixed `kind`.
 *
 * `staff.employmentType` FKs to `employment_types(name)`, so the database is the
 * real guard. This resolver exists so an unknown slug comes back as a clean 400
 * instead of a raw foreign-key error, and so the two write paths (HR create and
 * registration approval) derive behaviour identically rather than each
 * re-deciding what "external trainer" means.
 *
 * See project-docs/staff-personal-data-build-plan.md.
 */

import type { EmploymentKind } from '@denel/types'
import { eq } from 'drizzle-orm'
import type { DB } from '../db'
import { employmentTypes } from '../db/schema'

export interface ResolvedEmploymentType {
  /** The lookup slug, stored on staff.employmentType. */
  name: string
  kind: EmploymentKind
  /** Derived, never taken from the caller. */
  isExternalTrainer: boolean
  /** Fixed-term roles are the only ones a contract end date applies to. */
  expectsContractEndDate: boolean
}

/**
 * Resolve a slug against the lookup.
 *
 * Returns null when the slug is unknown or deactivated — callers turn that into
 * a 400. Inactive types are rejected on write but existing staff keep theirs:
 * deactivating a type stops new use, it doesn't rewrite history.
 */
export async function resolveEmploymentType(
  db: DB,
  name: string | null | undefined
): Promise<ResolvedEmploymentType | null> {
  if (!name?.trim()) return null
  const row = await db.query.employmentTypes.findFirst({
    where: eq(employmentTypes.name, name.trim()),
    columns: { name: true, kind: true, isActive: true },
  })
  if (!row?.isActive) return null

  const kind = row.kind as EmploymentKind
  return {
    name: row.name,
    kind,
    isExternalTrainer: kind === 'trainer',
    expectsContractEndDate: kind === 'contract',
  }
}

/** The slug used when a caller doesn't specify one. */
export const DEFAULT_EMPLOYMENT_TYPE = 'permanent'
