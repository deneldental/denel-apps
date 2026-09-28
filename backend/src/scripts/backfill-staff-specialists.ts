/**
 * backfill-staff-specialists.ts
 *
 * Phase 5A backfill — link existing `specialists` rows to `staff` rows and
 * derive the capability flags introduced in migration 0055.
 *
 * Rules:
 *   1. Internal specialists (specialistType='internal', userId IS NOT NULL):
 *      look up staff by matching userId. If found, link both ways and set
 *      flags. If missing, RECORD the orphan and skip — never auto-create
 *      a staff row from an internal specialist (HR must reconcile by hand).
 *
 *   2. External specialists (specialistType='external'): create a matching
 *      staff row with positionTag='non_staff', staffType='external',
 *      isExternal=true, isClinicalPractitioner=true, receivesCommission=true,
 *      hasPayslip=false, requiresLicense=true, tracksAttendance=false.
 *
 *   3. Existing `staff` rows untouched by either rule: defaults from the
 *      migration already apply (positionTag derived from staffType).
 *
 * Idempotent: skips specialists whose staffId is already set. Re-runnable
 * after an HR reconcile of the orphan list. Wraps each specialist's work in
 * its own transaction so a single orphan doesn't poison the batch.
 *
 * Run with:
 *   doppler run -- pnpm tsx src/scripts/backfill-staff-specialists.ts
 *   doppler run -- pnpm tsx src/scripts/backfill-staff-specialists.ts --dry
 */

import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')

const DRY = process.argv.includes('--dry')

const cleanUrl = DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')

const pool = new Pool({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } })
const db = drizzle(pool, { schema })

type OrphanRow = { specialistId: string; name: string; userId: string }

async function main() {
  console.log(`Phase 5A — staff↔specialists backfill ${DRY ? '(DRY RUN)' : ''}\n`)

  // Pull every specialist that hasn't been linked yet.
  const candidates = await db
    .select()
    .from(schema.specialists)
    .where(isNull(schema.specialists.staffId))

  if (candidates.length === 0) {
    console.log('Nothing to backfill — every specialist already has a staff link.')
    await pool.end()
    return
  }

  let linked = 0
  let createdExternal = 0
  const orphans: OrphanRow[] = []

  for (const spec of candidates) {
    if (spec.specialistType === 'internal') {
      if (!spec.userId) {
        // Internal specialist with no user → can't match to staff. Skip;
        // HR will need to reconcile by hand (probably a partially set-up
        // record from the old flow).
        orphans.push({ specialistId: spec.id, name: spec.name, userId: '(none)' })
        continue
      }

      const [staffRow] = await db
        .select()
        .from(schema.staff)
        .where(and(eq(schema.staff.userId, spec.userId), isNull(schema.staff.deletedAt)))
        .limit(1)

      if (!staffRow) {
        orphans.push({ specialistId: spec.id, name: spec.name, userId: spec.userId })
        continue
      }

      if (DRY) {
        console.log(
          `  [dry] LINK internal specialist '${spec.name}' (${spec.id}) ↔ staff '${staffRow.fullName}' (${staffRow.id})`
        )
        linked++
        continue
      }

      await db.transaction(async (tx) => {
        await tx
          .update(schema.staff)
          .set({
            specialistId: spec.id,
            isClinicalPractitioner: true,
            receivesCommission: false, // internal doctors don't earn commission
            hasPayslip: true,
            tracksAttendance: false,
            requiresLicense: true,
            isExternal: false,
          })
          .where(eq(schema.staff.id, staffRow.id))

        await tx
          .update(schema.specialists)
          .set({ staffId: staffRow.id })
          .where(eq(schema.specialists.id, spec.id))
      })

      linked++
      console.log(`  ✓ linked internal '${spec.name}' ↔ staff '${staffRow.fullName}'`)
      continue
    }

    // External specialist — create a non_staff record on the staff side.
    if (spec.specialistType === 'external') {
      if (DRY) {
        console.log(`  [dry] CREATE external staff record for '${spec.name}' (${spec.id})`)
        createdExternal++
        continue
      }

      // Generate a placeholder staffId code. Real onboarding picks a clean
      // FDM-S#### — for the backfill we tag it FDM-X#### so HR can spot the
      // backfilled rows on the staff list.
      const stamp = Date.now().toString().slice(-6)
      const placeholderCode = `FDM-X${stamp}`

      await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.staff)
          .values({
            staffId: placeholderCode,
            fullName: spec.name,
            email: spec.contactEmail ?? null,
            phone: spec.contactPhone ?? null,
            employmentType: 'external_trainer',
            staffType: 'external',
            positionTag: 'non_staff',
            isClinicalPractitioner: true,
            receivesCommission: true,
            hasPayslip: false,
            tracksAttendance: false,
            requiresLicense: true,
            isExternal: true,
            isExternalTrainer: false,
            specialistId: spec.id,
            position: 'Visiting Specialist',
            status: spec.isActive ? 'active' : 'inactive',
          })
          .returning()

        await tx
          .update(schema.specialists)
          .set({ staffId: created.id })
          .where(eq(schema.specialists.id, spec.id))
      })

      createdExternal++
      console.log(`  ✓ created external staff row for '${spec.name}'`)
      continue
    }

    // Unknown specialistType — log and move on.
    console.warn(
      `  ⚠ skipping specialist '${spec.name}' (${spec.id}) — unknown type '${spec.specialistType}'`
    )
  }

  // Backfill default flags for staff rows that have NO specialist link and
  // weren't touched above. Mostly a no-op (migration defaults handle this),
  // but explicit re-application makes the script convergent.
  if (!DRY) {
    const untouched = await db
      .select({ id: schema.staff.id, staffType: schema.staff.staffType })
      .from(schema.staff)
      .where(and(isNull(schema.staff.specialistId), isNull(schema.staff.deletedAt)))

    for (const row of untouched) {
      // Already correct from the migration defaults — only patch if we ever
      // diverge from the rule (kept as a no-op safety net).
      if (row.staffType === 'external') {
        await db
          .update(schema.staff)
          .set({ positionTag: 'non_staff', isExternal: true })
          .where(eq(schema.staff.id, row.id))
      }
    }
  }

  console.log(`\nResult:`)
  console.log(`  Internal linked: ${linked}`)
  console.log(`  External created: ${createdExternal}`)
  console.log(`  Orphans (need HR reconcile): ${orphans.length}`)

  if (orphans.length > 0) {
    console.log(`\nOrphans:`)
    for (const o of orphans) {
      console.log(`  - specialist '${o.name}' (id=${o.specialistId}, userId=${o.userId})`)
    }
    console.log(`\nResolve by either:`)
    console.log(
      `  (a) creating the missing staff row in the HR portal, then re-running this script`
    )
    console.log(`  (b) deleting/deactivating the orphan specialist in the specialists module`)
  }

  await pool.end()
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
