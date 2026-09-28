/**
 * Bridges the two ways an appointment type is identified in this codebase.
 *
 * `appointments.type` is free TEXT holding the type's NAME. Every writer sends a
 * name: the portal's add-appointment dialog and sheet both submit
 * `appointmentType.name`, and the walk-in / website-booking / invoice paths fall
 * back to the literal `'consultation'`.
 *
 * `appointment_type_reminders.appointmentTypeId` is a UUID FK to
 * `appointment_types.id`, because the settings UI keys reminder policies by the
 * type's id (and the FK is what stops a policy outliving its type).
 *
 * The reminder code originally compared those two directly. Postgres rejects
 * `uuid = 'consultation'` outright (22P02), so the on-booking path threw on every
 * appointment and the scheduler's per-type policies could never match. Both sides
 * now translate through here instead of guessing.
 *
 * A name that resolves to no row is not an error — `website-bookings` stores
 * `booking.service`, which is a service name and legitimately has no matching
 * appointment type. Callers treat `null` as "no explicit policy" and fall through
 * to the default (NULL `appointmentTypeId`) policy.
 */

import { inArray, notInArray, type SQL, sql } from 'drizzle-orm'
import type { getDb } from '../db'
import { appointments, appointmentTypes } from '../db/schema'

type Db = ReturnType<typeof getDb>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `appointments.type` → `appointment_types.id`.
 *
 * Accepts an id as well as a name: nothing writes one today, but the column is
 * untyped text and a caller that already holds an id should not be punished.
 */
export async function resolveAppointmentTypeId(
  db: Db,
  typeValue: string | null | undefined
): Promise<string | null> {
  const value = typeValue?.trim()
  if (!value) return null
  if (UUID_RE.test(value)) return value

  // Case-insensitive: the stored names are lower-case ('consultation'), but the
  // hardcoded fallbacks and website bookings are not guaranteed to match case.
  const [row] = await db
    .select({ id: appointmentTypes.id })
    .from(appointmentTypes)
    .where(sql`lower(${appointmentTypes.name}) = lower(${value})`)
    .limit(1)

  return row?.id ?? null
}

/**
 * `appointment_types.id[]` → a map of id to the name stored in `appointments.type`.
 *
 * Ids with no surviving type row are simply absent from the map; the FK makes
 * that unreachable today, but the caller has to handle a miss either way.
 */
export async function resolveAppointmentTypeNames(
  db: Db,
  ids: string[]
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (unique.length === 0) return new Map()

  const rows = await db
    .select({ id: appointmentTypes.id, name: appointmentTypes.name })
    .from(appointmentTypes)
    .where(inArray(appointmentTypes.id, unique))

  return new Map(rows.map((r) => [r.id, r.name]))
}

/**
 * `appointments.type` matches ONE configured type.
 *
 * Case-insensitive, to agree with `resolveAppointmentTypeId()`: an appointment
 * stored as 'Consultation' must not match its policy at booking time and then
 * miss the reminder pass.
 */
export function matchesAppointmentTypeName(typeName: string): SQL {
  return sql`lower(${appointments.type}) = lower(${typeName})`
}

/**
 * The default policy's reach: every appointment whose type has NO policy of its
 * own. `undefined` means "no filter" — with nothing explicitly configured, the
 * default applies to everything.
 *
 * Names are bound as parameters. The previous implementation interpolated ids
 * into the SQL text with `sql.raw`.
 */
export function excludesAppointmentTypeNames(typeNames: string[]): SQL | undefined {
  if (typeNames.length === 0) return undefined
  return notInArray(
    sql`lower(${appointments.type})`,
    typeNames.map((n) => n.toLowerCase())
  )
}
