/**
 * Keeps the personal-data child tables (migration 0177) in step with the legacy
 * flat columns on `staff` while both exist.
 *
 * 0177 is expand-only: the flat columns are still written and still drive most
 * read surfaces, and the child tables are canonical going forward. During that
 * overlap BOTH have to be written on create, or a staff member ends up with an
 * emergency contact in one place and not the other — which is the exact drift
 * this whole effort exists to remove.
 *
 * This is deliberately create-only. Ongoing edits go through the child-record
 * endpoints (staff-personal.ts), which are the canonical surface; mirroring
 * edits back onto the flat columns would mean two writers for one fact again.
 * The contract migration that drops the flat columns also deletes this file.
 *
 * See project-docs/staff-personal-data-build-plan.md §5 Phase 8.
 */

import type { DB } from '../db'
import { staffContacts, staffQualifications } from '../db/schema'

interface FlatPersonalData {
  emergencyContactName?: string | null
  emergencyContactRelationship?: string | null
  emergencyContactPhone?: string | null
  nextOfKinName?: string | null
  nextOfKinRelationship?: string | null
  nextOfKinPhone?: string | null
  highestQualification?: string | null
  institution?: string | null
  qualificationYear?: number | null
}

const present = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0

/**
 * Mirror a new staff member's flat personal data into the child tables.
 *
 * Mirrors migration 0177's backfill exactly, including its rules: a contact
 * needs a name OR a phone (most real records are phone-only, so requiring a
 * name would silently drop them), and the migrated qualification carries
 * `isHighest` because that's what the flat column meant.
 */
export async function syncPersonalChildRecords(
  db: DB,
  staffId: string,
  data: FlatPersonalData
): Promise<void> {
  const contacts: Array<typeof staffContacts.$inferInsert> = []

  if (present(data.emergencyContactName) || present(data.emergencyContactPhone)) {
    contacts.push({
      staffId,
      type: 'emergency',
      name: data.emergencyContactName ?? null,
      relationship: data.emergencyContactRelationship ?? null,
      phone: data.emergencyContactPhone ?? null,
      isPrimary: true,
    })
  }

  if (present(data.nextOfKinName) || present(data.nextOfKinPhone)) {
    contacts.push({
      staffId,
      type: 'next_of_kin',
      name: data.nextOfKinName ?? null,
      relationship: data.nextOfKinRelationship ?? null,
      phone: data.nextOfKinPhone ?? null,
      isPrimary: true,
    })
  }

  if (contacts.length) await db.insert(staffContacts).values(contacts)

  if (present(data.highestQualification)) {
    await db.insert(staffQualifications).values({
      staffId,
      qualification: (data.highestQualification as string).trim(),
      institution: data.institution ?? null,
      year: Number.isFinite(data.qualificationYear as number)
        ? (data.qualificationYear as number)
        : null,
      isHighest: true,
    })
  }
}
