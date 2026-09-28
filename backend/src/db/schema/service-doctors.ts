import { relations } from 'drizzle-orm'
import {
  boolean,
  integer,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { services } from './operations'
import { specialists } from './specialists'

// ── service_doctors ──────────────────────────────────────────────────────────
// Many-to-many between a service and the doctors who can perform it, with
// per-link commission. A service like "Root canal" can be billed at 60% for
// Dr. A and 55% for Dr. B. Rate is snapshotted onto invoice_lines at the time
// of billing so historical commissions aren't disturbed when rates change.

export const serviceDoctors = pgTable(
  'service_doctors',
  {
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => specialists.id, { onDelete: 'cascade' }),
    /** Per-doctor commission for this service, as a percentage 0–100.
     *  null = fall back to specialists.default_commission_rate at billing time. */
    commissionRate: integer('commission_rate'),
    /** Optional per-link withholding override; null = fall back to specialist's default. */
    withholdingTaxRate: integer('withholding_tax_rate'),
    /** Explicit per-link override: this doctor earns zero commission on this
     *  service regardless of commissionRate / default. Distinct from a null
     *  rate (which means "use default") so a checked toggle is preserved
     *  even if the rate field is later edited. */
    noCommission: boolean('no_commission').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.serviceId, t.doctorId] }),
  })
)

export const serviceDoctorsRelations = relations(serviceDoctors, ({ one }) => ({
  service: one(services, {
    fields: [serviceDoctors.serviceId],
    references: [services.id],
  }),
  doctor: one(specialists, {
    fields: [serviceDoctors.doctorId],
    references: [specialists.id],
  }),
}))
