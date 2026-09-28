import { integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Remittances — admin-v1 §14.2 / F. Recording payment of an accumulated statutory
 * payable to government (VAT 2300, NHIL/GETFund 2310, WHT 2320, PAYE 2330, SSNIT
 * 2340), which clears that payable in the GL (DR payable / CR bank).
 */
export const remittances = pgTable('remittances', {
  id: uuid('id').defaultRandom().primaryKey(),
  payableCode: text('payableCode').notNull(), // GL account code being remitted
  payableName: text('payableName'), // snapshot label for display
  amount: integer('amount').notNull(),
  reference: text('reference'), // GRA/SSNIT receipt or filing reference
  paidAt: timestamp('paidAt').defaultNow().notNull(),
  createdById: text('createdById'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})
