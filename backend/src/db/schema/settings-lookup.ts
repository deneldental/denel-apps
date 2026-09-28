import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

// ── Document Tags ─────────────────────────────────────────────────────────────
// Labels applied to patient documents (uploads, media) for categorisation.

export const documentTags = pgTable('document_tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(), // slug, e.g. "consent-form"
  displayName: text('display_name').notNull(),
  color: text('color').notNull().default('slate'), // slate|blue|green|yellow|red|purple|pink|cyan
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Staff Document Types ───────────────────────────────────────────────────────
// Categorisation labels for staff documents (contract, application, policy, …).
// Managed in HR Settings; backs the document-type tag on the staff Documents tab.

export const staffDocumentTypes = pgTable('staff_document_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(), // slug, e.g. "appointment_letter"
  displayName: text('display_name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Staff Titles (clinical positions) ──────────────────────────────────────────
// The "Title" a staff member picks during self-registration (Dental Surgeon,
// Dental Hygienist, …). Managed in HR Settings; plugs into the generic
// /api/lookups registry (same shape as staffDocumentTypes).

export const staffTitles = pgTable('staff_titles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(), // slug, e.g. "dental_surgeon"
  displayName: text('display_name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Employment Types (migration 0178) ────────────────────────────────────────
// Was a hard-coded enum + CHECK on staff.employmentType. Now admin-managed so
// HR can add types without a deploy.
//
// `kind` is the load-bearing part: employmentType drives BEHAVIOUR (external
// trainers are derived from it; only fixed-term staff have a contract end
// date). If admins could invent values, code could not key off the value. So
// admins own `name`/`displayName`/`isActive`, while `kind` classifies the row
// into one of three behaviours the code understands. Code asks about `kind`,
// never the label. `staff.employmentType` FKs to `name`, which is what stops an
// in-use type being deleted.
export const employmentTypes = pgTable('employment_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(), // slug, e.g. "locum_6mo"
  displayName: text('display_name').notNull(),
  /** 'permanent' | 'contract' | 'trainer' — CHECK-constrained. */
  kind: text('kind').notNull().default('permanent'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Departments (migration 0178) ─────────────────────────────────────────────
// Restored. Migration 0060 added this table, 0154 dropped it as dead surface
// area ("the clinic never populated departments"), then 0174 re-added
// staff.department as a hard-coded enum for the public self-registration form,
// where it is required — so the concept is live again and needs its lookup.
export const hrDepartments = pgTable('hr_departments', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(), // slug, e.g. "front_desk"
  displayName: text('display_name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Request Kinds ──────────────────────────────────────────────────────────────
// The top-level "Request" a staff member files (parent of the Types below).
// Previously a hard-coded enum (leave | permit | emergency | official_support);
// now admin-manageable so HR can add new request kinds. The four built-ins are
// isSystem rows (undeletable, slug-locked) so behaviour keyed on those slugs
// still works: leave → balance guard + excused-absence, permit → dates,
// emergency → amount. `showsDates` / `showsAmount` drive the form's optional
// fields, so custom kinds opt into either with no code change.

export const requestKinds = pgTable('request_kinds', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(), // slug, e.g. "leave", "training_request"
  displayName: text('display_name').notNull(),
  showsDates: boolean('shows_dates').notNull().default(false),
  showsAmount: boolean('shows_amount').notNull().default(false),
  isSystem: boolean('is_system').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Request Subtypes ───────────────────────────────────────────────────────────
// Configurable "Types" under a Request kind (parent slug in `category`, which
// references requestKinds.name). Shared by the staff request form and the HR
// "file request for staff" form. Managed in HR Settings.

export const requestSubtypes = pgTable('request_subtypes', {
  id: uuid('id').defaultRandom().primaryKey(),
  category: text('category').notNull(), // parent request kind slug → requestKinds.name
  name: text('name').notNull().unique(), // slug, e.g. "annual_leave"
  displayName: text('display_name').notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Inventory Locations ───────────────────────────────────────────────────────
// Physical storage locations for clinic inventory (cabinets, rooms, etc.).

export const inventoryLocations = pgTable('inventory_locations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(), // Short identifier, e.g. "STORE-A"
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Compliance Categories ─────────────────────────────────────────────────────
// Grouping labels for compliance documents and tasks.

export const complianceCategories = pgTable('compliance_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color').notNull().default('slate'),
  iconName: text('icon_name'), // Lucide icon name string
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Compliance Tags ───────────────────────────────────────────────────────────
// Admin-managed tags for tagging and categorizing compliance modules/items.

export const complianceTags = pgTable('compliance_tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(), // slug, e.g. "hipaa"
  displayName: text('display_name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Consent Templates ─────────────────────────────────────────────────────────
// Reusable consent form templates linked to PDF assets.

export const consentTemplates = pgTable('consent_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull().default('general'), // ortho|surgical|general|periodontal|extraction|other
  description: text('description'),
  pdfUrl: text('pdf_url'), // Public/CDN URL for display
  pdfKey: text('pdf_key'), // Storage object key (S3 / Cloudinary)
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Supplier Documents ────────────────────────────────────────────────────────
// File attachments (contracts, price lists, certs) linked to a supplier.

export const supplierDocuments = pgTable('supplier_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  supplierId: uuid('supplier_id').notNull(),
  title: text('title').notNull(),
  fileName: text('file_name').notNull(),
  fileUrl: text('file_url').notNull(),
  fileKey: text('file_key'), // S3 / Cloudinary object key
  sizeBytes: integer('size_bytes').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Supplier Price Items ──────────────────────────────────────────────────────
// Per-supplier price catalogue for inventory items.

export const supplierPriceItems = pgTable('supplier_price_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  supplierId: uuid('supplier_id').notNull(),
  itemName: text('item_name').notNull(),
  unit: text('unit').notNull(),
  unitPrice: integer('unit_price').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Ad Templates ──────────────────────────────────────────────────────────────
// Reusable SMS/email advertising copy templates for CRM campaigns.

export const adTemplates = pgTable('ad_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Sync Rules ────────────────────────────────────────────────────────────────
// Per-entity rules governing what data gets synced to the Reports database.
// entity is a unique text key (e.g. 'patients', 'appointments').

export const syncRules = pgTable('sync_rules', {
  entity: text('entity').notNull().unique().primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  filterCustom: text('filter_custom'), // natural-language predicate
  filterOptions: jsonb('filter_options').$type<Record<string, boolean>>(), // structured toggles
  lastSyncedAt: timestamp('last_synced_at'), // cached from last sync run
  recordsSynced: integer('records_synced').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Specialties (migration 0179) ─────────────────────────────────────────────
// `specialists.specialty` was free text; the only value in the data was
// "Ortho Verify Fix" — a test artefact that had become permanent data. Now an
// admin-managed lookup like its siblings, with specialists.specialty FKing to
// `name`, which is what stops an in-use specialisation being deleted.
export const specialties = pgTable('specialties', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(), // slug, e.g. "oral_surgery"
  displayName: text('display_name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
