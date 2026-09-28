import { relations } from 'drizzle-orm'
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

// --- RBAC TABLES ---

export const roles = pgTable('roles', {
  id: text('id').primaryKey(), // 'admin', 'doctor', 'receptionist'
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    module: text('module').notNull(), // e.g., 'appointments'
    action: text('action').notNull(), // 'create', 'read', 'update', 'delete'
    description: text('description'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => ({
    uniqueModuleAction: unique().on(t.module, t.action),
  })
)

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: text('roleId')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permissionId')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: [t.roleId, t.permissionId],
  })
)

// --- AUTH TABLES (Better-Auth) ---

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  emailVerified: boolean('emailVerified').notNull(),
  image: text('image'),
  role: text('role'), // Better Auth admin plugin expects this field
  banned: boolean('banned').default(false).notNull(), // Better Auth admin plugin expects this field
  banReason: text('banReason'), // Better Auth admin plugin optional field
  banExpires: timestamp('banExpires'), // Better Auth admin plugin optional field
  roleId: text('roleId').references(() => roles.id), // Link to RBAC role (our custom field)
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  impersonatedBy: text('impersonatedBy'), // Better Auth admin plugin field for impersonation
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt'),
  updatedAt: timestamp('updatedAt'),
})

// --- CLINIC MODULES ---

export const staff = pgTable('staff', {
  id: uuid('id').defaultRandom().primaryKey(),
  fullName: text('fullName').notNull(),
  role: text('role').notNull(),
  employmentType: text('employmentType').notNull(), // 'permanent', 'contract'
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const staffDocuments = pgTable('staff_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  fileUrl: text('fileUrl').notNull(), // URL to uploaded document in DigitalOcean Spaces
  uploadedAt: timestamp('uploadedAt').defaultNow().notNull(),
})

// --- CLINIC MODULES ---

export const doctors = pgTable('doctors', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(),
  specialty: text('specialty').notNull(),
  licenseNumber: text('licenseNumber'),
  bio: text('bio'),
  contactNumber: text('contactNumber'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const patients = pgTable('patients', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  dob: timestamp('dob').notNull(),
  gender: text('gender').notNull(), // 'male', 'female', 'other'
  address: text('address'),
  occupation: text('occupation'),
  profileImage: text('profileImage'), // URL or path to profile image
  patientId: text('patientId').unique(), // Format: #FDM000001
  type: text('type').default('general').notNull(), // 'general', 'external'
  isChild: boolean('isChild').default(false).notNull(),
  isOrtho: boolean('isOrtho').default(false).notNull(),
  // Guardian/Parent information (for child patients)
  guardianName: text('guardianName'),
  guardianPhone: text('guardianPhone'),
  guardianEmail: text('guardianEmail'),
  guardianAddress: text('guardianAddress'),
  guardianOccupation: text('guardianOccupation'),
  insuranceProvider: text('insuranceProvider'),
  insurancePolicyNumber: text('insurancePolicyNumber'),
  emergencyContactName: text('emergencyContactName'),
  emergencyContactPhone: text('emergencyContactPhone'),
  nationality: text('nationality').default('Ghana'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const appointments = pgTable('appointments', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  doctorId: uuid('doctorId')
    .notNull()
    .references(() => doctors.id, { onDelete: 'cascade' }),
  date: timestamp('date').notNull(),
  durationMinutes: integer('durationMinutes').default(30).notNull(),
  status: text('status').notNull(), // 'scheduled', 'completed', 'cancelled', 'no-show'
  type: text('type').notNull(), // 'consultation', 'checkup', 'follow-up', 'procedure'
  notes: text('notes'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const doctorUnavailability = pgTable('doctor_unavailability', {
  id: uuid('id').defaultRandom().primaryKey(),
  doctorId: uuid('doctorId')
    .notNull()
    .references(() => doctors.id, { onDelete: 'cascade' }),
  startTime: timestamp('startTime').notNull(),
  endTime: timestamp('endTime').notNull(),
  reason: text('reason'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const medicalRecords = pgTable('medical_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  doctorId: uuid('doctorId')
    .notNull()
    .references(() => doctors.id, { onDelete: 'cascade' }),
  createdById: text('createdById').references(() => user.id), // The user who created the record
  date: timestamp('date').defaultNow().notNull(),
  complaint: text('complaint'),
  examination: text('examination'),
  diagnosis: text('diagnosis'),
  treatment: text('treatment'),
  prescription: text('prescription'),
  notes: text('notes'),
  attachments: text('attachments'), // JSON or CSV string of URLs
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const pendingMedicalRecords = pgTable('pending_medical_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  doctorId: uuid('doctorId')
    .notNull()
    .references(() => doctors.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointmentId').references(() => appointments.id, { onDelete: 'set null' }),
  checkedInAt: timestamp('checkedInAt').defaultNow().notNull(),
  status: text('status').default('pending').notNull(), // 'pending', 'completed'
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  completedAt: timestamp('completedAt'),
})

export const inventory = pgTable('inventory', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  sku: text('sku').unique(),
  category: text('category'),
  unit: text('unit'), // gallon, kg, pcs, box, pack, etc
  stockQuantity: integer('stockQuantity').notNull().default(0), // Number of units in stock
  reorderLevel: integer('reorderLevel').default(10),
  image: text('image'), // Base64 encoded image or URL
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  sku: text('sku').unique(),
  category: text('category'),
  unit: text('unit'), // gallon, kg, pcs, box, pack, etc
  price: integer('price').notNull(), // Selling price per single item (in cents)
  costPrice: integer('costPrice'), // Cost price per single item (in cents) - set when product is sold
  stockQuantity: integer('stockQuantity').notNull().default(0), // Number of packs/units in stock
  quantityPerPack: integer('quantityPerPack').default(1).notNull(), // Number of individual items per pack/unit
  reorderLevel: integer('reorderLevel').default(10),
  image: text('image'), // Base64 encoded image or URL
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'cascade' }), // Optional, could be walk-in
  appointmentId: uuid('appointmentId').references(() => appointments.id, { onDelete: 'set null' }), // Optional link
  paymentPlanId: uuid('paymentPlanId').references(() => paymentPlans.id, { onDelete: 'set null' }), // Link to payment plan if part of a plan
  amount: integer('amount').notNull(), // In cents
  method: text('method').notNull(), // 'cash', 'card', 'insurance', 'transfer', 'momo', 'bank_transfer'
  status: text('status').notNull(), // 'pending', 'completed', 'failed', 'refunded'
  description: text('description'),
  transactionId: text('transactionId'),
  sendNotification: boolean('sendNotification').default(false).notNull(), // SMS notification toggle
  balance: integer('balance'), // Balance at time of payment (in cents) - for payment plan payments
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const paymentPlanTemplates = pgTable('payment_plan_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  totalAmount: integer('totalAmount').notNull(), // In cents
  amountPerInstallment: integer('amountPerInstallment').notNull(), // In cents
  paymentFrequency: text('paymentFrequency').notNull(), // 'weekly', 'monthly', 'biweekly', 'custom'
  isDefault: boolean('isDefault').default(false).notNull(),
  isActive: boolean('isActive').default(true).notNull(),
  description: text('description'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const paymentPlans = pgTable('payment_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' })
    .unique(),
  templateId: uuid('templateId').references(() => paymentPlanTemplates.id, {
    onDelete: 'set null',
  }),
  type: text('type').default('fixed').notNull(), // 'fixed' or 'flexible'
  totalAmount: integer('totalAmount').notNull(), // In cents
  amountPerInstallment: integer('amountPerInstallment'), // In cents - nullable for flexible plans
  paymentFrequency: text('paymentFrequency'), // 'weekly', 'monthly', 'biweekly', 'custom' - nullable for flexible plans
  startDate: timestamp('startDate').notNull(),
  status: text('status').default('activated').notNull(), // 'activated', 'completed', 'overdue', 'paused', 'outstanding'
  notes: text('notes'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const expenses = pgTable('expenses', {
  id: uuid('id').defaultRandom().primaryKey(),
  category: text('category').notNull(), // 'rent', 'supplies', 'payroll', 'utilities', 'other'
  amount: integer('amount').notNull(), // In cents
  date: timestamp('date').notNull(),
  description: text('description'),
  paidTo: text('paidTo'),
  paymentMethod: text('paymentMethod'),
  attachmentUrl: text('attachmentUrl'), // URL to uploaded document in DigitalOcean Spaces
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const dailyReports = pgTable('daily_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  reportDate: timestamp('reportDate').notNull(),
  checkedInCount: integer('checkedInCount').notNull(),
  newPatientsCount: integer('newPatientsCount').notNull(),
  totalPayments: integer('totalPayments').notNull(), // In cents
  totalExpenses: integer('totalExpenses').notNull(), // In cents
  balances: jsonb('balances').notNull(), // Array of { method: string, amount: number }
  inventoryUsed: jsonb('inventoryUsed').notNull().default('[]'), // Array of { id: string, quantity: number }
  productsSold: jsonb('productsSold').notNull().default('[]'), // Array of { id: string, quantity: number }
  additionalNote: text('additionalNote'), // Note when expenses exceed payments
  submittedById: text('submittedById')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const sales = pgTable('sales', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('productId')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(),
  unitPrice: integer('unitPrice').notNull(), // Selling price at time of sale (in cents)
  costPrice: integer('costPrice').notNull(), // Cost price at time of sale (in cents)
  totalAmount: integer('totalAmount').notNull(), // quantity * unitPrice (in cents)
  profit: integer('profit').notNull(), // (unitPrice - costPrice) * quantity (in cents)
  saleDate: timestamp('saleDate').defaultNow().notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  senderId: text('senderId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  receiverId: text('receiverId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  read: boolean('read').default(false).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const units = pgTable('units', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'), // Optional display name (e.g., "Pieces (pcs)")
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const appointmentTypes = pgTable('appointment_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'), // Optional display name
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const treatmentTypes = pgTable('treatment_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'), // Optional display name
  isActive: boolean('isActive').default(true).notNull(),
  autoSyncEnabled: boolean('autoSyncEnabled').default(false).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const expenseCategories = pgTable('expense_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'), // Optional display name
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const paymentMethods = pgTable('payment_methods', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'), // Optional display name
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const smsMessages = pgTable('sms_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  messageId: text('messageId'), // Hubtel message ID (for single messages)
  batchId: text('batchId'), // Hubtel batch ID (for batch messages)
  recipient: text('recipient').notNull(), // Phone number
  content: text('content').notNull(), // Message content
  type: text('type').notNull(), // 'bulk', 'birthday', 'followup'
  status: text('status').default('sent').notNull(), // 'sent', 'delivered', 'failed', 'pending'
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'set null' }), // Optional patient reference
  from: text('from').default('Framada').notNull(), // Sender name
  sentById: text('sentById').references(() => user.id, { onDelete: 'set null' }), // User who sent the SMS
  sentAt: timestamp('sentAt').defaultNow().notNull(),
  deliveredAt: timestamp('deliveredAt'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  action: text('action').notNull(), // 'create', 'update', 'delete', 'login', 'logout', etc.
  module: text('module').notNull(), // 'patients', 'appointments', 'products', etc.
  entityId: text('entityId'), // ID of the affected entity (if applicable)
  entityName: text('entityName'), // Name/description of the affected entity
  changes: jsonb('changes'), // JSON object with before/after values
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const orthoConsentForms = pgTable('ortho_consent_forms', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' })
    .unique(),
  consentFormUrl: text('consentFormUrl'), // URL to uploaded consent form
  status: text('status').default('unsigned').notNull(), // 'signed', 'unsigned'
  uploadedById: text('uploadedById').references(() => user.id, { onDelete: 'set null' }),
  uploadedAt: timestamp('uploadedAt'),
  notes: text('notes'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const syncLog = pgTable('sync_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityType: text('entityType').notNull(), // 'medical_record', 'payment'
  entityId: uuid('entityId').notNull(),
  syncMode: text('syncMode').notNull(), // 'auto', 'manual'
  destination: text('destination'), // Hash or identifier of destination
  success: boolean('success').notNull(),
  errorMessage: text('errorMessage'),
  syncedAt: timestamp('syncedAt').defaultNow().notNull(),
})

// --- RELATIONS ---

export const userRelations = relations(user, ({ one, many }) => ({
  role: one(roles, {
    fields: [user.roleId],
    references: [roles.id],
  }),
  doctorProfile: one(doctors, {
    fields: [user.id],
    references: [doctors.userId],
  }),
  sentMessages: many(messages, { relationName: 'sentMessages' }),
  receivedMessages: many(messages, { relationName: 'receivedMessages' }),
  dailyReports: many(dailyReports),
  auditLogs: many(auditLogs),
  uploadedConsentForms: many(orthoConsentForms),
}))

export const roleRelations = relations(roles, ({ many }) => ({
  users: many(user),
  permissions: many(rolePermissions),
}))

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}))

export const doctorsRelations = relations(doctors, ({ one, many }) => ({
  user: one(user, {
    fields: [doctors.userId],
    references: [user.id],
  }),
  appointments: many(appointments),
  availabilities: many(doctorUnavailability),
}))

export const patientsRelations = relations(patients, ({ many, one }) => ({
  appointments: many(appointments),
  medicalRecords: many(medicalRecords),
  payments: many(payments),
  paymentPlan: one(paymentPlans, {
    fields: [patients.id],
    references: [paymentPlans.patientId],
  }),
  smsMessages: many(smsMessages),
  orthoConsentForm: one(orthoConsentForms, {
    fields: [patients.id],
    references: [orthoConsentForms.patientId],
  }),
}))

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  patient: one(patients, {
    fields: [appointments.patientId],
    references: [patients.id],
  }),
  doctor: one(doctors, {
    fields: [appointments.doctorId],
    references: [doctors.id],
  }),
}))

export const doctorUnavailabilityRelations = relations(doctorUnavailability, ({ one }) => ({
  doctor: one(doctors, {
    fields: [doctorUnavailability.doctorId],
    references: [doctors.id],
  }),
}))

export const medicalRecordsRelations = relations(medicalRecords, ({ one }) => ({
  patient: one(patients, {
    fields: [medicalRecords.patientId],
    references: [patients.id],
  }),
  doctor: one(doctors, {
    fields: [medicalRecords.doctorId],
    references: [doctors.id],
  }),
  createdBy: one(user, {
    fields: [medicalRecords.createdById],
    references: [user.id],
  }),
}))

export const pendingMedicalRecordsRelations = relations(pendingMedicalRecords, ({ one }) => ({
  patient: one(patients, {
    fields: [pendingMedicalRecords.patientId],
    references: [patients.id],
  }),
  doctor: one(doctors, {
    fields: [pendingMedicalRecords.doctorId],
    references: [doctors.id],
  }),
  appointment: one(appointments, {
    fields: [pendingMedicalRecords.appointmentId],
    references: [appointments.id],
  }),
}))

export const paymentsRelations = relations(payments, ({ one }) => ({
  patient: one(patients, {
    fields: [payments.patientId],
    references: [patients.id],
  }),
  paymentPlan: one(paymentPlans, {
    fields: [payments.paymentPlanId],
    references: [paymentPlans.id],
  }),
}))

export const paymentPlanTemplatesRelations = relations(paymentPlanTemplates, ({ many }) => ({
  paymentPlans: many(paymentPlans),
}))

export const paymentPlansRelations = relations(paymentPlans, ({ one, many }) => ({
  patient: one(patients, {
    fields: [paymentPlans.patientId],
    references: [patients.id],
  }),
  template: one(paymentPlanTemplates, {
    fields: [paymentPlans.templateId],
    references: [paymentPlanTemplates.id],
  }),
  payments: many(payments),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  sender: one(user, {
    fields: [messages.senderId],
    references: [user.id],
    relationName: 'sentMessages',
  }),
  receiver: one(user, {
    fields: [messages.receiverId],
    references: [user.id],
    relationName: 'receivedMessages',
  }),
}))

export const smsMessagesRelations = relations(smsMessages, ({ one }) => ({
  patient: one(patients, {
    fields: [smsMessages.patientId],
    references: [patients.id],
  }),
  sentBy: one(user, {
    fields: [smsMessages.sentById],
    references: [user.id],
  }),
}))

export const dailyReportsRelations = relations(dailyReports, ({ one }) => ({
  submittedBy: one(user, {
    fields: [dailyReports.submittedById],
    references: [user.id],
  }),
}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(user, {
    fields: [auditLogs.userId],
    references: [user.id],
  }),
}))

export const orthoConsentFormsRelations = relations(orthoConsentForms, ({ one }) => ({
  patient: one(patients, {
    fields: [orthoConsentForms.patientId],
    references: [patients.id],
  }),
  uploadedBy: one(user, {
    fields: [orthoConsentForms.uploadedById],
    references: [user.id],
  }),
}))

export const staffRelations = relations(staff, ({ many }) => ({
  documents: many(staffDocuments),
}))

export const staffDocumentsRelations = relations(staffDocuments, ({ one }) => ({
  staff: one(staff, {
    fields: [staffDocuments.staffId],
    references: [staff.id],
  }),
}))
