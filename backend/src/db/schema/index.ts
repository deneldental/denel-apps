// Domain schema files — each file owns one domain's tables + relations.
// Cross-domain relations that would create circular imports live at the bottom.
export * from './accounting'
export * from './activity-completions'
export * from './api-keys'
export * from './attendance'
export * from './auth'
export * from './billing'
export * from './bills'
export * from './breakfast'
export * from './clinical'
export * from './commissions'
export * from './comms'
export * from './credit-notes'
export * from './cron'
export * from './documents'
export * from './google-calendar'
export * from './inventory'
export * from './invoice-lines'
export * from './kiosk'
export * from './operations'
export * from './patient-tags'
export * from './patients'
export * from './payment-allocations'
export * from './payment-plan-schedule-items'
export * from './push'
export * from './remittances'
export * from './revenue-recognition'
export * from './service-doctors'
export * from './settings-lookup'
export * from './specialists'
export * from './staff'
export * from './tasks'

// ── Cross-domain relations ────────────────────────────────────────────────────
// These reference tables from multiple domain files and therefore cannot be
// placed in any single domain file without introducing circular imports.

import { relations } from 'drizzle-orm'
import { journalEntries } from './accounting'
import { roles, user } from './auth'
import { dailyReports, invoices, paymentPlans, payments } from './billing'
import {
  appointments,
  doctors,
  medicalRecords,
  orthoConsentForms,
  patientCases,
  prescriptions,
} from './clinical'
import {
  appointmentTypeReminders,
  appointmentTypeRemindersRelations,
  messages,
  scheduledReminders,
  smsMessages,
} from './comms'
import { invoiceLines } from './invoice-lines'
import { auditLogs } from './operations'
import {
  patientSessions,
  patients,
  patientTimeline,
  patientWallets,
  walletTransactions,
} from './patients'

// patientsRelations: spans clinical, billing, comms, and auth domains
export const patientsRelations = relations(patients, ({ many, one }) => ({
  appointments: many(appointments),
  medicalRecords: many(medicalRecords),
  cases: many(patientCases),
  prescriptions: many(prescriptions),
  payments: many(payments),
  paymentPlans: many(paymentPlans),
  invoices: many(invoices),
  wallet: one(patientWallets, {
    fields: [patients.id],
    references: [patientWallets.patientId],
  }),
  walletTransactions: many(walletTransactions),
  timeline: many(patientTimeline),
  smsMessages: many(smsMessages),
  scheduledReminders: many(scheduledReminders),
  pwaAccessGrantedBy: one(user, {
    fields: [patients.pwaAccessGrantedById],
    references: [user.id],
  }),
  sessions: many(patientSessions),
  orthoConsentForm: one(orthoConsentForms, {
    fields: [patients.id],
    references: [orthoConsentForms.patientId],
  }),
}))

// All user relations in one relations() call — consolidating here avoids Drizzle's
// runtime/TypeScript issues where multiple relations() for the same table cause
// "Cannot read properties of undefined (reading 'referencedTable')" errors at
// query time. Domain-specific user relations from billing/comms/operations are
// merged into this single source of truth (auth.ts cannot hold these refs because
// of circular imports).
export const userRelations = relations(user, ({ one, many }) => ({
  rbacRole: one(roles, {
    fields: [user.roleId],
    references: [roles.id],
  }),
  // Alias for older route handlers that query `with: { role: true }`.
  // Same target as rbacRole — different relationName so Drizzle treats them
  // as separate registrations and lets either name resolve to the same join.
  role: one(roles, {
    fields: [user.roleId],
    references: [roles.id],
    relationName: 'userRoleAlias',
  }),
  doctorProfile: one(doctors, {
    fields: [user.id],
    references: [doctors.userId],
  }),
  uploadedConsentForms: many(orthoConsentForms),
  // — merged from billing.ts (was userBillingRelations)
  dailyReports: many(dailyReports),
  // — merged from comms.ts (was userCommsRelations)
  sentMessages: many(messages, { relationName: 'sentMessages' }),
  receivedMessages: many(messages, { relationName: 'receivedMessages' }),
  // — merged from operations.ts (was userOperationsRelations)
  auditLogs: many(auditLogs),
}))

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  patient: one(patients, {
    fields: [invoices.patientId],
    references: [patients.id],
  }),
  plan: one(paymentPlans, {
    fields: [invoices.planId],
    references: [paymentPlans.id],
  }),
  payments: many(payments),
  journalEntry: one(journalEntries, {
    fields: [invoices.journalEntryId],
    references: [journalEntries.id],
  }),
  voidedByUser: one(user, {
    fields: [invoices.voidedBy],
    references: [user.id],
    relationName: 'invoiceVoidedBy',
  }),
  createdByUser: one(user, {
    fields: [invoices.createdBy],
    references: [user.id],
    relationName: 'invoiceCreatedBy',
  }),
  lines: many(invoiceLines),
}))
