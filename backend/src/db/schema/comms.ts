import { relations } from 'drizzle-orm'
import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { user } from './auth'
import { appointments } from './clinical'
import { appointmentTypes } from './operations'
import { patients } from './patients'

// ── Internal Messages (staff ↔ staff) ─────────────────────────────────────────

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

// ── SMS Messages ──────────────────────────────────────────────────────────────

export const smsMessages = pgTable('sms_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  messageId: text('messageId'),
  batchId: text('batchId'),
  recipient: text('recipient').notNull(),
  content: text('content').notNull(),
  type: text('type').notNull(), // 'bulk', 'birthday', 'followup'
  status: text('status').default('sent').notNull(),
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'set null' }),
  from: text('from').default('Denel').notNull(),
  sentById: text('sentById').references(() => user.id, { onDelete: 'set null' }),
  sentAt: timestamp('sentAt').defaultNow().notNull(),
  deliveredAt: timestamp('deliveredAt'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Email Messages ────────────────────────────────────────────────────────────

export const emailMessages = pgTable('email_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  resendId: text('resendId'),
  recipient: text('recipient').notNull(),
  subject: text('subject').notNull(),
  content: text('content').notNull(),
  type: text('type').notNull(),
  status: text('status').default('sent').notNull(),
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'set null' }),
  from: text('from').default('Denel Dental <info@deneldental.com>').notNull(),
  sentById: text('sentById').references(() => user.id, { onDelete: 'set null' }),
  sentAt: timestamp('sentAt').defaultNow().notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Reminder Templates (admin-managed, reused for patient-specific reminders) ─
export const reminderTemplates = pgTable('reminder_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  // Stable identifier for system-event templates (e.g. 'lab_status:sent') so
  // backend code can resolve a template by key. NULL for free-form templates.
  key: text('key'),
  messageTemplate: text('messageTemplate').notNull(), // supports {firstName}, {date}, {time}, {clinicName}
  isActive: boolean('isActive').default(true).notNull(),
  /**
   * Admin-only visibility. When true the template is filtered out of every
   * non-admin listing — the CRM template manager and the scheduling/reminder
   * template picker both read the same endpoint, so one flag hides it portal-wide.
   */
  adminOnly: boolean('adminOnly').default(false).notNull(),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Scheduled Reminders ───────────────────────────────────────────────────────

export const scheduledReminders = pgTable('scheduled_reminders', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'appointment_pre' | 'birthday' | 'payment_due' | 'custom' | 'patient_specific'
  triggerType: text('triggerType').notNull(), // 'before_appointment' | 'on_date' | 'recurring'
  triggerOffsetHours: integer('triggerOffsetHours'),
  scheduledAt: timestamp('scheduledAt'),
  cronExpression: text('cronExpression'),
  messageTemplate: text('messageTemplate').notNull(),
  isActive: boolean('isActive').default(true).notNull(),
  status: text('status').default('pending'), // 'pending' | 'sent' | 'cancelled'
  lastRunAt: timestamp('lastRunAt'),
  // Patient-specific reminder fields (null for system-level reminders)
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'cascade' }),
  templateId: uuid('templateId').references(() => reminderTemplates.id, { onDelete: 'set null' }),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  // §13.2 — confirm-before-send. Marketing sends are auto-queued with
  // requiresConfirmation=true and held by the scheduler until a staff member
  // confirms (sets confirmedAt). Transactional reminders leave it false.
  requiresConfirmation: boolean('requiresConfirmation').default(false).notNull(),
  confirmedAt: timestamp('confirmedAt'),
  confirmedById: text('confirmedById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Website Bookings ──────────────────────────────────────────────────────────

export const websiteBookings = pgTable('website_bookings', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone').notNull(),
  preferredDate: text('preferredDate'),
  preferredTime: text('preferredTime'),
  service: text('service'),
  message: text('message'),
  status: text('status').default('new').notNull(),
  staffNotes: text('staffNotes'),
  /** Patient-visible reason shown when the clinic cancels a request. Required
   *  when cancelling a patient-app (source='patient_pwa') request. */
  cancellationReason: text('cancellationReason'),
  source: text('source').default('website'),
  patientId: uuid('patientId'),
  requestType: text('requestType').default('new'),
  relatedAppointmentId: uuid('relatedAppointmentId'),
  appointmentId: uuid('appointmentId').references(() => appointments.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Sync Log ──────────────────────────────────────────────────────────────────

export const syncLog = pgTable('sync_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityType: text('entityType').notNull(),
  entityId: uuid('entityId').notNull(),
  syncMode: text('syncMode').notNull(),
  destination: text('destination'),
  success: boolean('success').notNull(),
  errorMessage: text('errorMessage'),
  syncedAt: timestamp('syncedAt').defaultNow().notNull(),
})

// ── Appointment Type Reminders ────────────────────────────────────────────────

export const appointmentTypeReminders = pgTable('appointment_type_reminders', {
  id: uuid('id').defaultRandom().primaryKey(),
  // If null, this applies as the global default for unconfigured types
  appointmentTypeId: uuid('appointmentTypeId').references(() => appointmentTypes.id, {
    onDelete: 'cascade',
  }),
  triggerType: text('triggerType').notNull(), // 'on_booking' | 'before_appointment'
  offsetHours: integer('offsetHours'), // e.g., 24, 8. Null for 'on_booking'
  templateId: uuid('templateId')
    .notNull()
    .references(() => reminderTemplates.id),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// H3 — one row per (appointment, policy) reminder actually sent. Unlike
// scheduled_reminders (one row, one lastRunAt stamp), a `before_appointment`
// policy fires against many appointments per tick, so there's no single
// column to stamp — this table is the idempotency record instead. The
// unique index is what makes a manual re-run of the scheduler (or two
// overlapping ticks) safe: the second attempt's insert is a no-op
// (`onConflictDoNothing`), so `processAppointmentTypeReminders` never
// re-sends the same reminder for the same appointment twice. See
// project-docs/patient-records-and-scheduling-audit.md, H3.
export const appointmentTypeReminderSends = pgTable(
  'appointment_type_reminder_sends',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    appointmentId: uuid('appointmentId')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    policyId: uuid('policyId')
      .notNull()
      .references(() => appointmentTypeReminders.id, { onDelete: 'cascade' }),
    sentAt: timestamp('sentAt').defaultNow().notNull(),
  },
  (t) => ({
    appointmentPolicyUniq: uniqueIndex('appt_type_reminder_sends_appt_policy_uniq').on(
      t.appointmentId,
      t.policyId
    ),
  })
)

// ── Relations ─────────────────────────────────────────────────────────────────

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

export const reminderTemplatesRelations = relations(reminderTemplates, ({ one }) => ({
  createdBy: one(user, {
    fields: [reminderTemplates.createdById],
    references: [user.id],
  }),
}))

export const scheduledRemindersRelations = relations(scheduledReminders, ({ one }) => ({
  patient: one(patients, {
    fields: [scheduledReminders.patientId],
    references: [patients.id],
  }),
  template: one(reminderTemplates, {
    fields: [scheduledReminders.templateId],
    references: [reminderTemplates.id],
  }),
  createdBy: one(user, {
    fields: [scheduledReminders.createdById],
    references: [user.id],
  }),
}))

export const appointmentTypeRemindersRelations = relations(appointmentTypeReminders, ({ one }) => ({
  appointmentType: one(appointmentTypes, {
    fields: [appointmentTypeReminders.appointmentTypeId],
    references: [appointmentTypes.id],
  }),
  template: one(reminderTemplates, {
    fields: [appointmentTypeReminders.templateId],
    references: [reminderTemplates.id],
  }),
}))

export const appointmentTypeReminderSendsRelations = relations(
  appointmentTypeReminderSends,
  ({ one }) => ({
    appointment: one(appointments, {
      fields: [appointmentTypeReminderSends.appointmentId],
      references: [appointments.id],
    }),
    policy: one(appointmentTypeReminders, {
      fields: [appointmentTypeReminderSends.policyId],
      references: [appointmentTypeReminders.id],
    }),
  })
)

// User relations are consolidated in `schema/index.ts` (`userRelations`) to avoid
// Drizzle's "multiple relations(user, ...) calls" footgun. sentMessages and
// receivedMessages are wired up there.
