/**
 * admin-v1 §2.7 (EXPAND) — patient tag write / list-filter / auto-tag smoke.
 *
 * Mirrors the route behaviour against the real dev DB inside `withRollback`
 * (always rolled back; the shared dev DB is never mutated). The route's
 * tag-sync + list-filter SQL is reproduced here against `tx`; the ortho
 * auto-tag is exercised through the shared `applyOrthoTag` service the
 * patient-cases route calls.
 *
 * Run: `doppler run -- pnpm --filter backend test admin-v1-patient-tags`
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  caseStages,
  patientCases,
  patients,
  patientTagLinks,
  patientTags,
} from '../../src/db/schema'
import { AUTO_TAG_NAMES, applyOrthoTag, applyTagByName } from '../../src/lib/patient-auto-tag'
import { anyUserId } from './_fixtures'
import { noDb, withRollback } from './_setup'

// ── Local helpers mirroring the patients route (§2.7) ─────────────────────────

async function tagIdByName(tx: DB, name: string): Promise<string> {
  const [t] = await tx
    .select({ id: patientTags.id })
    .from(patientTags)
    .where(eq(patientTags.name, name))
  if (!t) throw new Error(`tag '${name}' is not seeded in the dev DB`)
  return t.id
}

/** Create a patient and link the given tag ids — the WRITE path's tag sync. */
async function makeTaggedPatient(
  tx: DB,
  opts: { name?: string; isChild?: boolean; tagIds?: string[]; assignedById: string }
): Promise<string> {
  const [p] = await tx
    .insert(patients)
    .values({
      name: opts.name ?? 'IT Tag Patient',
      dob: new Date('1990-01-01'),
      gender: 'other',
      isChild: opts.isChild ?? false,
    })
    .returning()

  const desired = new Set(opts.tagIds ?? [])
  // §2.7 — Pediatric is always ensured for child patients (additive).
  if (opts.isChild) desired.add(await tagIdByName(tx, AUTO_TAG_NAMES.PEDIATRIC))
  if (desired.size > 0) {
    await tx
      .insert(patientTagLinks)
      .values(
        [...desired].map((tagId) => ({ patientId: p.id, tagId, assignedById: opts.assignedById }))
      )
      .onConflictDoNothing()
  }
  return p.id
}

async function tagsOf(tx: DB, patientId: string): Promise<string[]> {
  const rows = await tx
    .select({ name: patientTags.name })
    .from(patientTagLinks)
    .innerJoin(patientTags, eq(patientTags.id, patientTagLinks.tagId))
    .where(eq(patientTagLinks.patientId, patientId))
    .orderBy(asc(patientTags.name))
  return rows.map((r) => r.name)
}

/** Reproduce the LIST `?tagIds[]=` filter: patient has ANY of the tag ids. */
async function listByTags(tx: DB, tagIds: string[], candidateIds: string[]): Promise<string[]> {
  const rows = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(
      and(
        inArray(patients.id, candidateIds),
        sql`exists (select 1 from ${patientTagLinks} ptl where ptl."patientId" = ${patients.id} and ptl."tagId" in (${sql.join(
          tagIds.map((id) => sql`${id}`),
          sql`, `
        )}))`
      )
    )
  return rows.map((r) => r.id)
}

describe.skipIf(noDb)('admin-v1 §2.7 — patient tags expand path', () => {
  it('creating a patient with tagIds links them', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const vip = await tagIdByName(tx, 'VIP')
      const insurance = await tagIdByName(tx, 'Insurance')
      const pid = await makeTaggedPatient(tx, {
        name: 'IT Tagged',
        tagIds: [vip, insurance],
        assignedById: userId,
      })
      expect(await tagsOf(tx, pid)).toEqual(['Insurance', 'VIP'])
    })
  })

  it('isChild auto-adds the Pediatric tag', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const pid = await makeTaggedPatient(tx, {
        name: 'IT Child',
        isChild: true,
        tagIds: [],
        assignedById: userId,
      })
      expect(await tagsOf(tx, pid)).toContain('Pediatric')
    })
  })

  it('?tagIds list filter matches patients having ANY of the given tags', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const vip = await tagIdByName(tx, 'VIP')
      const insurance = await tagIdByName(tx, 'Insurance')

      const vipPatient = await makeTaggedPatient(tx, {
        name: 'IT VIP',
        tagIds: [vip],
        assignedById: userId,
      })
      const insPatient = await makeTaggedPatient(tx, {
        name: 'IT Ins',
        tagIds: [insurance],
        assignedById: userId,
      })
      const untagged = await makeTaggedPatient(tx, {
        name: 'IT None',
        tagIds: [],
        assignedById: userId,
      })
      const candidates = [vipPatient, insPatient, untagged]

      const onlyVip = await listByTags(tx, [vip], candidates)
      expect(onlyVip).toEqual([vipPatient])

      const either = await listByTags(tx, [vip, insurance], candidates)
      expect(either.sort()).toEqual([vipPatient, insPatient].sort())
      expect(either).not.toContain(untagged)
    })
  })

  it('tagCounts reflect how many candidate patients carry each tag', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const vip = await tagIdByName(tx, 'VIP')
      const a = await makeTaggedPatient(tx, {
        name: 'IT CountA',
        tagIds: [vip],
        assignedById: userId,
      })
      const b = await makeTaggedPatient(tx, {
        name: 'IT CountB',
        tagIds: [vip],
        assignedById: userId,
      })
      const candidates = [a, b]

      // Mirrors the route's per-tag count for the VIP chip, scoped to our rows.
      const [row] = await tx
        .select({ count: sql<number>`cast(count(distinct ${patients.id}) as integer)` })
        .from(patientTags)
        .leftJoin(patientTagLinks, eq(patientTagLinks.tagId, patientTags.id))
        .leftJoin(
          patients,
          and(eq(patients.id, patientTagLinks.patientId), inArray(patients.id, candidates))
        )
        .where(eq(patientTags.id, vip))
        .groupBy(patientTags.id)
      expect(row?.count).toBe(2)
    })
  })

  it('saving an ortho case stage auto-applies the Ortho tag (idempotent)', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const pid = await makeTaggedPatient(tx, {
        name: 'IT Ortho',
        tagIds: [],
        assignedById: userId,
      })

      const [pc] = await tx
        .insert(patientCases)
        .values({
          patientId: pid,
          caseNumber: `CASE-IT-${pid.slice(0, 8)}`,
          status: 'open',
          createdById: userId,
        })
        .returning()

      // Simulate the patient-cases stage POST: an ortho_review stage fires the
      // same `applyOrthoTag` the route calls.
      await tx
        .insert(caseStages)
        .values({ caseId: pc.id, stageType: 'ortho_review', data: {}, createdById: userId })
      await applyOrthoTag(tx, pid, userId)
      // Re-fire to prove idempotency (ON CONFLICT DO NOTHING).
      await applyOrthoTag(tx, pid, userId)

      const tags = await tagsOf(tx, pid)
      expect(tags).toEqual(['Ortho'])
    })
  })

  it('applyTagByName is a no-op for an unseeded tag name', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const pid = await makeTaggedPatient(tx, {
        name: 'IT NoTag',
        tagIds: [],
        assignedById: userId,
      })
      const applied = await applyTagByName(tx, pid, 'TotallyMissingTag', userId)
      expect(applied).toBe(false)
      expect(await tagsOf(tx, pid)).toEqual([])
    })
  })
})
