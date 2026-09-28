import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { staff } from './staff'

// admin-v1 CC.3 — reusable kiosk / device-pairing framework. Admin-paired devices
// + per-operator PINs let shared clinical stations run ONE locked-down surface
// (X-ray first, §9.9) without a full portal login. Two factors: the device's
// paired token (something it has) + the operator PIN (something they know).

export const kioskDevices = pgTable('kiosk_devices', {
  id: uuid('id').defaultRandom().primaryKey(),
  label: text('label').notNull(), // e.g. "X-ray Room PC"
  location: text('location'),
  surface: text('surface').notNull(), // scope, e.g. 'xrays'
  // Pending-pairing state: admin generated a one-time code; device not yet paired.
  pairingCodeHash: text('pairingCodeHash'),
  pairingExpiresAt: timestamp('pairingExpiresAt'),
  // Paired state: device redeemed the code for a long-lived device token.
  deviceTokenHash: text('deviceTokenHash'),
  pairedAt: timestamp('pairedAt'),
  lastSeenAt: timestamp('lastSeenAt'),
  isActive: boolean('isActive').notNull().default(true),
  revokedAt: timestamp('revokedAt'),
  pairedById: text('pairedById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const kioskOperators = pgTable('kiosk_operators', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  // Slow-hashed PIN (scrypt). Low-entropy secret -> rate-limit + lockout below.
  pinHash: text('pinHash').notNull(),
  // Per-surface capability sets, e.g. { "xrays": ["can_capture", "can_share"] }.
  // Effective actions at a station = surface scope ∩ operator capabilities.
  capabilities: jsonb('capabilities').notNull().default('{}'),
  isActive: boolean('isActive').notNull().default(true),
  failedAttempts: integer('failedAttempts').notNull().default(0),
  lockedUntil: timestamp('lockedUntil'),
  // Bumped on PIN reset / capability change / deactivate; embedded in the signed
  // session so a stale session (old epoch) is rejected before its token expires.
  sessionEpoch: integer('sessionEpoch').notNull().default(0),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})
