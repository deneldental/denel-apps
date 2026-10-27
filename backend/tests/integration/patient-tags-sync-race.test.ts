/**
 * Regression test for the Medium finding "Patient tag writes: a full-replace
 * endpoint and two additive endpoints operate on the same rows with
 * different semantics" (project-docs/patient-records-and-scheduling-audit.md):
 * a full-replace save built from a stale tag snapshot (e.g. the Edit Patient
 * sheet, opened before an unrelated ortho-review-stage save auto-applies
 * 'Ortho' moments later) used to silently strip the just-auto-applied tag,
 * because only Pediatric was protected from removal — every other system tag
 * wasn't.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { patientTagLinks, patientTags } from '../../src/db/schema'
import { syncPatientTags } from '../../src/routes/patients'
import { anyUserId, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

async function makeTag(
  tx: Parameters<typeof makePatient>[0],
  opts: { isSystem?: boolean } = {}
): Promise<string> {
  const [tag] = await tx
    .insert(patientTags)
    .values({ name: `IT Tag ${randomUUID().slice(0, 8)}`, isSystem: opts.isSystem ?? false })
    .returning()
  return tag.id
}

describe.skipIf(noDb)('syncPatientTags — system tags survive a stale full-replace [Medium]', () => {
  it('does not remove a system tag even when the caller omits it from tagIds', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const systemTagId = await makeTag(tx, { isSystem: true })
      const ordinaryTagId = await makeTag(tx)

      // Simulate the auto-tag having just fired (e.g. an ortho-review-stage
      // save) — the system tag is linked, but the caller's tagIds below
      // (built from a form loaded before that happened) never knew about it.
      await tx.insert(patientTagLinks).values({ patientId, tagId: systemTagId })
      await tx.insert(patientTagLinks).values({ patientId, tagId: ordinaryTagId })

      // The stale save: only the ordinary tag is in the desired set, and the
      // system tag is conspicuously absent — the exact shape of the race.
      await syncPatientTags(tx, patientId, [ordinaryTagId], userId, false)

      const links = await tx
        .select({ tagId: patientTagLinks.tagId })
        .from(patientTagLinks)
        .where(eq(patientTagLinks.patientId, patientId))
      const linkedTagIds = links.map((l) => l.tagId)

      expect(linkedTagIds).toContain(systemTagId)
      expect(linkedTagIds).toContain(ordinaryTagId)
    })
  })

  it('still removes an ordinary tag the caller genuinely unchecked', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const ordinaryTagId = await makeTag(tx)

      await tx.insert(patientTagLinks).values({ patientId, tagId: ordinaryTagId })

      // Caller's desired set is empty — deliberately unchecking the tag.
      await syncPatientTags(tx, patientId, [], userId, false)

      const links = await tx
        .select({ tagId: patientTagLinks.tagId })
        .from(patientTagLinks)
        .where(eq(patientTagLinks.patientId, patientId))

      expect(links).toHaveLength(0)
    })
  })
})
