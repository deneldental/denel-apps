import { boolean, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { inventoryLocations } from './settings-lookup'

// ── Suppliers ─────────────────────────────────────────────────────────────────

export const suppliers = pgTable('suppliers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  contactEmail: text('contactEmail'),
  contactPhone: text('contactPhone'),
  address: text('address'),
  paymentTerms: text('paymentTerms'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  // ── Phase 6 finance fields ────────────────────────────────────────────────
  tin: text('tin'),
  defaultPaymentTermsDays: integer('default_payment_terms_days').default(30),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// `inventory` and `products` used to be declared here. Both tables were dropped
// by migration 0102_items_contract.sql when the unified `items` catalog below
// replaced them; the declarations lingered and made the ORM describe tables that
// no longer exist. Removed after confirming no query references them.

// ── Items (admin-v1 §12.1) ──────────────────────────────────────────────────────
// Unified catalog merging `products` (retail/store) + `inventory` (clinical
// consumables) into one table with capability flags. An item can be more than one
// thing (e.g. sellable AND consumable). Built via the expand/contract migration
// 0100 (additive backfill, ids preserved); `products`/`inventory` are retained as
// back-compat aliases during cutover and retired in a later gated contract migration.
export const items = pgTable('items', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  // sku unique index is deferred to the contract migration (cross-table dup risk).
  sku: text('sku'),
  category: text('category'), // legacy free-text; §11.6 maps to categoryId
  categoryId: uuid('categoryId'), // §11.6 typed categories (no constraint yet)
  unit: text('unit'),
  stockQuantity: integer('stockQuantity').notNull().default(0),
  reorderLevel: integer('reorderLevel').default(10),
  image: text('image'),
  // Money — nullable; sellable rows carry price. costPrice merges
  // products.costPrice + inventory.unitCost (same concept).
  price: integer('price').$type<number | null>(),
  costPrice: integer('costPrice').$type<number | null>(),
  // Retail / pack fields (ex-products; NULL for ex-inventory).
  sizeValue: integer('sizeValue'),
  sizeUnit: text('sizeUnit'),
  quantityPerPack: integer('quantityPerPack').default(1).notNull(),
  // Clinical / stock fields (ex-inventory; NULL for ex-products). §11.3 batches supersede.
  expiryDate: timestamp('expiryDate'),
  lotNumber: text('lotNumber'),
  supplierId: uuid('supplierId'), // soft fk
  // Capability flags — an item can hold several. Backfill sets sellable for
  // ex-products, consumable for ex-inventory; medication/lab set later (§11.6).
  sellable: boolean('sellable').notNull().default(false),
  consumable: boolean('consumable').notNull().default(false),
  medication: boolean('medication').notNull().default(false),
  lab: boolean('lab').notNull().default(false),
  isLocked: boolean('isLocked').default(false).notNull(),
  source: text('source'), // 'product' | 'inventory' — legacy provenance
  // §12.3: tax classification for invoice-line split-ledger (F2)
  taxStatus: text('taxStatus').notNull().default('exempt'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Lookup tables ─────────────────────────────────────────────────────────────

export const units = pgTable('units', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  // §11.6: purpose classifies the category ('consumable' | 'medication' | 'lab' | 'product')
  purpose: text('purpose'),
  // §11.6: default taxStatus for items in this category
  taxStatusDefault: text('taxStatusDefault').notNull().default('exempt'),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Stock Movements (admin-v1 §11.1) ──────────────────────────────────────────
// One row per stock event: receipt / issue / adjustment / transfer_out /
// transfer_in / wastage. qty is positive for in-bound movements and negative
// for out-bound ones.

export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').defaultRandom().primaryKey(),
  itemId: uuid('itemId')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'receipt' | 'issue' | 'adjustment' | 'transfer_out' | 'transfer_in' | 'wastage'
  qty: integer('qty').notNull(),
  unitCost: integer('unitCost'),
  locationId: uuid('locationId').references(() => inventoryLocations.id, { onDelete: 'set null' }),
  reason: text('reason'),
  receiptUrl: text('receiptUrl'),
  sourceType: text('sourceType'),
  sourceId: uuid('sourceId'),
  journalEntryId: uuid('journalEntryId'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Inventory Batches (admin-v1 §11.3) ────────────────────────────────────────
// One row per receipt line; qtyRemaining is drawn down FEFO (earliest expiry
// first) by issueStockFefo. Null expiryDate rows are consumed last.

export const inventoryBatches = pgTable('inventory_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  itemId: uuid('itemId')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  locationId: uuid('locationId').references(() => inventoryLocations.id, { onDelete: 'set null' }),
  movementId: uuid('movementId').references(() => stockMovements.id, { onDelete: 'cascade' }),
  qtyRemaining: integer('qtyRemaining').notNull(),
  unitCost: integer('unitCost'),
  expiryDate: timestamp('expiryDate'),
  lotNumber: text('lotNumber'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})
