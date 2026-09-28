import { relations } from 'drizzle-orm'
import { boolean, integer, jsonb, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'

/**
 * Document signing engine — admin-v1 CC.4.
 *
 * A reusable template (PDF + a field map) is filled + signed into an immutable
 * instance, OR a pre-signed scan is uploaded directly. First consumer: Consents
 * (§18.5); compliance docs / HR contracts reuse it later.
 */

// A field region placed on the template PDF by the visual editor.
// { id, page, x, y, w, h (PDF points, origin bottom-left), type, binding?, signerRole? }
export interface TemplateField {
  id: string
  page: number
  x: number
  y: number
  w: number
  h: number
  type: 'text' | 'name' | 'address' | 'date' | 'signature' | 'initials' | 'checkbox'
  binding?: string // e.g. 'patient.name' — auto-filled from the subject record
  signerRole?: string // 'patient' | 'witness' | 'clinician' for multi-signer
}

export const documentTemplates = pgTable('document_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(), // 'consent' | 'compliance' | 'hr' | 'supplier' | 'other'
  description: text('description'),
  pdfUrl: text('pdfUrl').notNull(), // source template PDF in object storage
  fields: jsonb('fields').notNull().default('[]'), // TemplateField[]
  isActive: boolean('isActive').notNull().default(true),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const documentInstances = pgTable('document_instances', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Null when a scan is uploaded with no template behind it.
  templateId: uuid('templateId').references(() => documentTemplates.id, { onDelete: 'set null' }),
  title: text('title').notNull(), // snapshot of the document name
  subjectType: text('subjectType').notNull(), // 'patient' | 'staff'
  subjectId: uuid('subjectId').notNull(),
  mode: text('mode').notNull(), // 'digital' (filled+signed) | 'uploaded' (scan)
  status: text('status').notNull().default('draft'), // 'draft' | 'sent' | 'partially_signed' | 'completed'
  signingOrder: text('signingOrder').default('SEQUENTIAL'), // 'PARALLEL' | 'SEQUENTIAL'
  signedPdfUrl: text('signedPdfUrl'), // flattened/uploaded completed PDF
  contentHash: text('contentHash'), // sha256 of the completed PDF bytes
  fieldValues: jsonb('fieldValues'), // { [fieldId]: value } (deprecated in favor of document_fields table, but kept for compatibility)
  signers: jsonb('signers'), // [{ role, name, signedAt }] (deprecated in favor of document_signers table, but kept for compatibility)
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  completedAt: timestamp('completedAt'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const documentSigners = pgTable('document_signers', {
  id: uuid('id').defaultRandom().primaryKey(),
  instanceId: uuid('instanceId')
    .references(() => documentInstances.id, { onDelete: 'cascade' })
    .notNull(),
  order: integer('order').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  status: text('status').notNull().default('PENDING'), // 'PENDING' | 'SIGNED'
  signedAt: timestamp('signedAt'),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  signatureImageUrl: text('signatureImageUrl'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const documentFields = pgTable('document_fields', {
  id: uuid('id').defaultRandom().primaryKey(),
  instanceId: uuid('instanceId')
    .references(() => documentInstances.id, { onDelete: 'cascade' })
    .notNull(),
  signerId: uuid('signerId')
    .references(() => documentSigners.id, { onDelete: 'cascade' })
    .notNull(),
  type: text('type').notNull(), // 'signature' | 'initials' | 'text' | 'date' | 'checkbox'
  page: integer('page').notNull(),
  x: real('x').notNull(),
  y: real('y').notNull(),
  w: real('w').notNull(),
  h: real('h').notNull(),
  value: text('value'),
})

export const documentInstancesRelations = relations(documentInstances, ({ many, one }) => ({
  template: one(documentTemplates, {
    fields: [documentInstances.templateId],
    references: [documentTemplates.id],
  }),
  signers: many(documentSigners),
  fields: many(documentFields),
}))

export const documentSignersRelations = relations(documentSigners, ({ one, many }) => ({
  instance: one(documentInstances, {
    fields: [documentSigners.instanceId],
    references: [documentInstances.id],
  }),
  fields: many(documentFields),
}))

export const documentFieldsRelations = relations(documentFields, ({ one }) => ({
  instance: one(documentInstances, {
    fields: [documentFields.instanceId],
    references: [documentInstances.id],
  }),
  signer: one(documentSigners, {
    fields: [documentFields.signerId],
    references: [documentSigners.id],
  }),
}))
