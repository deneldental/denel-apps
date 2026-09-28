import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

/**
 * Patient tags — admin-v1 §2.7. A flexible, admin-managed label set applied to
 * patients (e.g. Ortho, VIP, Recall Due), replacing ad-hoc boolean flags over time.
 * Added additively; isOrtho/type stay until their consumers are migrated.
 *
 * FKs live in the DB (migration 0109); columns are plain here to avoid cross-domain
 * schema imports.
 */
export const patientTags = pgTable('patient_tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color').notNull().default('slate'), // tailwind colour name
  isActive: boolean('isActive').notNull().default(true),
  isSystem: boolean('isSystem').notNull().default(false),
  /**
   * Stable identifier for tags that drive behaviour, independent of the display
   * name. NULL for ordinary user-created tags.
   *
   * Business logic must match on this, never on `name`. Three patient forms used
   * to do `tagCatalog.find(t => t.name.toLowerCase() === 'insurance')`, which
   * bound to whichever of the duplicate 'Insurance'/'insurance' rows the API
   * returned first — so ticking the insurance chip did not reliably open the
   * provider/policy fields. Keying on systemKey also means the tag can be
   * renamed in Settings ("Has Insurance", "NHIS") without breaking the trigger.
   */
  systemKey: text('systemKey').unique(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

/** System keys that carry behaviour. Values are stable; display names are not. */
export const PATIENT_TAG_SYSTEM_KEYS = {
  /** Opens the insurance provider + policy-number fields in patient create/edit. */
  INSURANCE: 'insurance',
  XRAY: 'xray',
  LAB: 'lab',
  /**
   * Marks a patient as orthodontic. Gates the ortho branch of the Review stage
   * and the ortho payment-plan card at check-in. Was an ordinary user tag
   * matched by the literal name 'Ortho' — case-sensitively, so renaming it in
   * Settings silently disabled every ortho feature (0206).
   */
  ORTHO: 'ortho',
} as const

export type PatientTagSystemKey =
  (typeof PATIENT_TAG_SYSTEM_KEYS)[keyof typeof PATIENT_TAG_SYSTEM_KEYS]

export const patientTagLinks = pgTable(
  'patient_tag_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    patientId: uuid('patientId').notNull(),
    tagId: uuid('tagId').notNull(),
    assignedById: text('assignedById'),
    assignedAt: timestamp('assignedAt').defaultNow().notNull(),
  },
  (t) => ({ uniq: unique('patient_tag_links_uniq').on(t.patientId, t.tagId) })
)
