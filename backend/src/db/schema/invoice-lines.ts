import { relations } from 'drizzle-orm'
import { boolean, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { accounts } from './accounting'
import { user } from './auth'
import { invoices } from './billing'
import { specialists } from './specialists'

// ── Invoice Lines ─────────────────────────────────────────────────────────────
// One row per chargeable item on an invoice. Replaces the legacy
// `invoices.treatments` JSONB blob with structured columns so we can post a
// proper journal entry, drive specialist commissions, and report revenue by
// category. See finance spec §5.10.

export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').notNull(),
  treatmentId: uuid('treatment_id'),
  // Pricing-matrix tracing (0167): which catalog service + matrix cell + variant/
  // tooth-class priced this line. Soft FKs (no constraint), like treatment_id.
  serviceId: uuid('service_id'),
  servicePriceId: uuid('service_price_id'),
  variantName: text('variant_name'),
  toothClassId: uuid('tooth_class_id'),
  description: text('description').notNull(),
  // A COUNT, not money — stays numeric(10, 2) in the DB (0033) so a fractional
  // quantity is representable. Deliberately excluded from the 0209 cents
  // migration; see that file's header.
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1').$type<number>(),
  unitPrice: integer('unit_price').notNull().$type<number>(),
  // Surcharge (0215): the counterpart to discount below — staff can mark a
  // line up above the catalog price (VIP add-ons, after-hours, complexity),
  // same dual-semantic value encoding as discount. No reason/eligibility gate
  // by design — governance here is the admin-only price-adjustments report,
  // not a checkout-time prompt. Applied to lineSubtotal BEFORE discount, so a
  // discount can still net against a surcharged line.
  surchargeType: text('surcharge_type').notNull().default('none'), // 'none' | 'percent' | 'amount'
  surchargeValue: integer('surcharge_value').notNull().default(0).$type<number>(),
  surchargeAmount: integer('surcharge_amount').notNull().default(0).$type<number>(),
  surchargeAuthorizedBy: text('surcharge_authorized_by').references(() => user.id, {
    onDelete: 'set null',
  }),
  discountType: text('discount_type').notNull().default('none'), // 'none' | 'percent' | 'amount'
  // Dual-semantic, keyed off `discountType`: a whole-number PERCENTAGE when
  // 'percent' (10 = 10%), otherwise an amount in CENTS. 0209 scales only the
  // 'amount' rows.
  discountValue: integer('discount_value').notNull().default(0).$type<number>(),
  discountAmount: integer('discount_amount').notNull().default(0).$type<number>(),
  discountReason: text('discount_reason'),
  discountAuthorizedBy: text('discount_authorized_by').references(() => user.id, {
    onDelete: 'set null',
  }),
  lineSubtotal: integer('line_subtotal').notNull().$type<number>(),
  lineAfterDiscount: integer('line_after_discount').notNull().$type<number>(),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0').$type<number>(),
  taxAmount: integer('tax_amount').notNull().default(0).$type<number>(),
  lineTotal: integer('line_total').notNull().$type<number>(),
  revenueAccountId: uuid('revenue_account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'restrict' }),
  providerId: text('provider_id').references(() => user.id, { onDelete: 'set null' }),
  specialistId: uuid('specialist_id').references(() => specialists.id, { onDelete: 'set null' }),
  commissionRate: integer('commission_rate'),
  // Phase 9: when true, the line's revenue at invoice issue posts to
  // 2400 Deferred Revenue instead of `revenue_account_id`. Recognised over
  // time via `revenue_recognition_events`.
  deferRevenue: boolean('defer_revenue').notNull().default(false),
  // F2 split-ledger: tax classification copied from services.taxStatus at line
  // creation. Drives revenue-account routing when VAT split-posting is enabled.
  taxStatus: text('taxStatus').notNull().default('exempt'),
})

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceLines.invoiceId],
    references: [invoices.id],
  }),
  revenueAccount: one(accounts, {
    fields: [invoiceLines.revenueAccountId],
    references: [accounts.id],
  }),
  provider: one(user, {
    fields: [invoiceLines.providerId],
    references: [user.id],
    relationName: 'invoiceLineProvider',
  }),
  authorizer: one(user, {
    fields: [invoiceLines.discountAuthorizedBy],
    references: [user.id],
    relationName: 'invoiceLineAuthorizer',
  }),
  surchargeAuthorizer: one(user, {
    fields: [invoiceLines.surchargeAuthorizedBy],
    references: [user.id],
    relationName: 'invoiceLineSurchargeAuthorizer',
  }),
  specialist: one(specialists, {
    fields: [invoiceLines.specialistId],
    references: [specialists.id],
  }),
}))
