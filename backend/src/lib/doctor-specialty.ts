/**
 * The specialty a `doctors` row shows (D17 / F47).
 *
 * The `doctors` row is what an appointment points at, and the appointment screens print its
 * `specialty`. It used to be filled with a hard-coded placeholder ("General" for in-house,
 * "Specialist" for visiting) and never touched again, so an orthodontist showed as "General".
 * It now takes the specialist's own specialty, as the lookup's display name, and follows edits.
 *
 * `specialists.specialty` is a slug that is a foreign key to the `specialties` lookup, so a
 * display name always exists in practice. The readable-text fallback is defensive: a lookup row
 * removed by hand must not turn into a raw slug on an appointment.
 */
import { eq, inArray } from 'drizzle-orm'
import { doctors, specialists, specialties } from '../db/schema'
import type { DbLike } from './account-sessions'

/** `paediatric_dentistry` becomes `Paediatric Dentistry`. */
export function prettifySpecialty(raw: string): string {
  return raw
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * What the doctor row should say for this specialist. No specialty keeps the old placeholders,
 * which is what the row said for everyone before.
 */
export function doctorRowSpecialty(
  specialist: { specialty?: string | null; specialistType: string },
  labels: ReadonlyMap<string, string>
): string {
  const slug = specialist.specialty?.trim()
  if (slug) return labels.get(slug) ?? prettifySpecialty(slug)
  return specialist.specialistType === 'internal' ? 'General' : 'Specialist'
}

/** Display names for these specialty slugs, as `slug` to `display name`. */
export async function specialtyLabels(
  db: DbLike,
  slugs: ReadonlyArray<string | null | undefined>
): Promise<Map<string, string>> {
  const wanted = [...new Set(slugs.filter((s): s is string => !!s?.trim()))]
  if (wanted.length === 0) return new Map()
  const rows = await db
    .select({ name: specialties.name, displayName: specialties.displayName })
    .from(specialties)
    .where(inArray(specialties.name, wanted))
  return new Map(rows.filter((r) => r.displayName).map((r) => [r.name, r.displayName]))
}

/**
 * Bring a specialist's doctor row in step after the specialist's specialty changed. A specialist
 * that has no doctor row yet needs nothing: the row is made, correctly, the first time the
 * scheduler lists doctors.
 */
export async function syncDoctorSpecialty(db: DbLike, specialistId: string): Promise<void> {
  const [specialist] = await db
    .select({ specialty: specialists.specialty, specialistType: specialists.specialistType })
    .from(specialists)
    .where(eq(specialists.id, specialistId))
  if (!specialist) return
  const labels = await specialtyLabels(db, [specialist.specialty])
  await db
    .update(doctors)
    .set({ specialty: doctorRowSpecialty(specialist, labels), updatedAt: new Date() })
    .where(eq(doctors.specialistId, specialistId))
}
