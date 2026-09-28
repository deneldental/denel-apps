import { relations } from 'drizzle-orm'
import { boolean, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
// staff is referenced via raw uuid (no import) to avoid a circular dep
// — `staff.specialistId` already points here, and `specialists.staffId`
// completes the bidirectional 1:1.

// ── Specialists ───────────────────────────────────────────────────────────────
// The canonical "doctor" entity. `specialistType` distinguishes internal
// employees (with a linked user account for login + per-user GCal OAuth)
// from external/visiting specialists who only earn a commission and have no
// portal account.

export const specialists = pgTable('specialists', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  /** Free-text specialisation label — "Orthodontist", "Endodontist", etc.
   *  PR-16: not enum-locked so HR can use clinic-specific labels. */
  specialty: text('specialty'),
  /** Avatar URL (DO Spaces). PR-16. */
  profileImage: text('profile_image'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  tin: text('tin'),
  /** 'internal' (clinic employee, usually has userId) or 'external' (visiting). */
  specialistType: text('specialist_type').notNull().default('external'),
  /** Optional link to a `user` row. Only meaningful for internal specialists. */
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  /** The Google Calendar id this specialist's appointments sync to (SA mode).
   *  Auto-provisioned on first sync — one calendar per specialist, shared
   *  with them so they see only their own appointments. */
  gcalCalendarId: text('gcal_calendar_id'),
  defaultCommissionRate: numeric('default_commission_rate', { precision: 5, scale: 2 })
    .notNull()
    .default('0')
    .$type<number>(),
  withholdingTaxRate: numeric('withholding_tax_rate', { precision: 5, scale: 2 })
    .notNull()
    .default('0')
    .$type<number>(),
  payoutMethod: text('payout_method'), // 'bank' | 'momo'
  payoutAccountDetails: jsonb('payout_account_details').$type<Record<string, unknown>>(),
  isActive: boolean('is_active').notNull().default(true),
  // 1:1 link to `staff`. Internal specialists always have one (HR is the
  // canonical source of "who this person is"). External specialists get a
  // matching staff row with `positionTag = 'non_staff'` and `isExternal = true`.
  staffId: uuid('staff_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const specialistsRelations = relations(specialists, ({ one }) => ({
  user: one(user, {
    fields: [specialists.userId],
    references: [user.id],
  }),
}))
