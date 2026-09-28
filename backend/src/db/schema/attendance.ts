import { relations } from 'drizzle-orm'
import {
  date,
  index,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { user } from './auth'
import { staff } from './staff'

// Lateness "queries" issued by the weekly lateness-policy cron (Phase I).
// One row per escalation: a staff who is late >= threshold times in a week gets
// the next cumulative level (1=SMS warning, 2=written-note query, 3=management
// meeting). `weekStart` is the Monday of the flagged week (idempotency key).
//
// The sms* columns record what the alert SMS actually did, so HR's Lateness Log
// tab can show "was this person told?" without guessing from `sms_messages`
// (which is keyed on patient, not staff). Null `smsStatus` = a row written
// before this tracking existed.
export const staffLatenessQueries = pgTable(
  'staff_lateness_queries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staffId')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    weekStart: date('weekStart').notNull(), // Monday YYYY-MM-DD of the flagged week
    level: integer('level').notNull(), // 1 | 2 | 3 (capped)
    lateCount: integer('lateCount').notNull(),
    // 'sent' | 'failed' | 'no_phone' — null for pre-tracking rows.
    smsStatus: text('smsStatus'),
    smsSentAt: timestamp('smsSentAt'),
    smsRecipient: text('smsRecipient'), // phone at send time
    smsMessage: text('smsMessage'), // rendered body, for the audit trail
    smsError: text('smsError'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => ({
    // At most one query per staff per week (the cron is idempotent on re-run).
    uniqueWeek: unique('staff_lateness_queries_unique_week').on(t.staffId, t.weekStart),
    staffIdx: index('staff_lateness_queries_staff_idx').on(t.staffId),
  })
)

// Raw clock events ingested from the hardware reader CSV.
// One row per swipe. Daily/monthly summaries are computed on the fly
// in `backend/src/lib/attendance.ts` — no materialized daily table at this scale.
export const attendanceEvents = pgTable(
  'attendance_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Resolved staff row. Nullable so an upload can land before a staff record
    // is created with a matching deviceUserId — backfill happens when staff.deviceUserId is set.
    staffId: uuid('staffId').references(() => staff.id, { onDelete: 'set null' }),
    deviceUserId: text('deviceUserId').notNull(),
    deviceUserName: text('deviceUserName'),
    eventTimestamp: timestamp('eventTimestamp', { withTimezone: true }).notNull(),
    deviceNo: text('deviceNo'),
    rawStatus: text('rawStatus'),
    sourceFile: text('sourceFile'),
    uploadedById: text('uploadedById').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => ({
    // sourceFile is intentionally NOT in the unique tuple — re-uploading the
    // same CSV under a different name must not create duplicates.
    uniqueEvent: unique('attendance_events_unique_event').on(
      t.deviceUserId,
      t.eventTimestamp,
      t.deviceNo,
      t.rawStatus
    ),
    staffTsIdx: index('attendance_events_staff_ts_idx').on(t.staffId, t.eventTimestamp),
    deviceUserIdx: index('attendance_events_device_user_idx').on(t.deviceUserId),
  })
)

// Per-day overrides: excused absences, holidays, off-days. Approved leave
// requests in `staff_requests` are honored without writing here — the helper
// joins them at compute time.
export const attendanceExceptions = pgTable(
  'attendance_exceptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staffId')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    type: text('type').notNull(), // 'excused_absence' | 'off_day' | 'holiday'
    reason: text('reason'),
    createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => ({
    uniqueException: unique('attendance_exceptions_unique').on(t.staffId, t.date, t.type),
    staffDateIdx: index('attendance_exceptions_staff_date_idx').on(t.staffId, t.date),
  })
)

export const attendanceEventsRelations = relations(attendanceEvents, ({ one }) => ({
  staff: one(staff, {
    fields: [attendanceEvents.staffId],
    references: [staff.id],
  }),
  uploadedBy: one(user, {
    fields: [attendanceEvents.uploadedById],
    references: [user.id],
  }),
}))

export const attendanceExceptionsRelations = relations(attendanceExceptions, ({ one }) => ({
  staff: one(staff, {
    fields: [attendanceExceptions.staffId],
    references: [staff.id],
  }),
  createdBy: one(user, {
    fields: [attendanceExceptions.createdById],
    references: [user.id],
  }),
}))

// Per-staff recurring weekly off-day pattern. dayOfWeek: 0=Sun..6=Sat.
// Drives the "is this day a working day for this staff" decision in the
// attendance lib alongside the global Saturday default and clinic holidays.
export const staffOffDays = pgTable(
  'staff_off_days',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staffId')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    dayOfWeek: integer('dayOfWeek').notNull(), // 0..6
    reason: text('reason'),
    createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => ({
    uniqueStaffDow: unique('staff_off_days_unique').on(t.staffId, t.dayOfWeek),
  })
)

// Clinic-wide holidays. No staff_id — applies to everyone.
export const clinicHolidays = pgTable(
  'clinic_holidays',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    date: date('date').notNull(),
    name: text('name').notNull(),
    // 'full' = non-scoring day for everyone; 'half' = clinic closes early, so
    // the day still scores on clock-in but the early clock-out penalty is waived.
    type: text('type').notNull().default('full'),
    createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => ({
    uniqueDate: unique('clinic_holidays_unique_date').on(t.date),
  })
)

export const staffOffDaysRelations = relations(staffOffDays, ({ one }) => ({
  staff: one(staff, {
    fields: [staffOffDays.staffId],
    references: [staff.id],
  }),
  createdBy: one(user, {
    fields: [staffOffDays.createdById],
    references: [user.id],
  }),
}))

export const clinicHolidaysRelations = relations(clinicHolidays, ({ one }) => ({
  createdBy: one(user, {
    fields: [clinicHolidays.createdById],
    references: [user.id],
  }),
}))

export const staffAttendanceSubmissions = pgTable(
  'staff_attendance_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staffId')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    punchType: text('punchType').notNull(), // 'clock_in' | 'clock_out'
    time: time('time').notNull(), // HH:mm:ss
    reason: text('reason'),
    status: text('status').default('pending').notNull(), // 'pending' | 'approved' | 'rejected'
    reviewedById: text('reviewedById').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewedAt'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (t) => ({
    staffDateIdx: index('staff_attendance_submissions_staff_date_idx').on(t.staffId, t.date),
  })
)

export const attendanceTimeOverrides = pgTable(
  'attendance_time_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staffId')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    clockIn: time('clockIn'),
    clockOut: time('clockOut'),
    createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => ({
    uniqueOverride: unique('attendance_time_overrides_unique').on(t.staffId, t.date),
  })
)

export const staffAttendanceSubmissionsRelations = relations(
  staffAttendanceSubmissions,
  ({ one }) => ({
    staff: one(staff, {
      fields: [staffAttendanceSubmissions.staffId],
      references: [staff.id],
    }),
    reviewedBy: one(user, {
      fields: [staffAttendanceSubmissions.reviewedById],
      references: [user.id],
    }),
  })
)

export const attendanceTimeOverridesRelations = relations(attendanceTimeOverrides, ({ one }) => ({
  staff: one(staff, {
    fields: [attendanceTimeOverrides.staffId],
    references: [staff.id],
  }),
  createdBy: one(user, {
    fields: [attendanceTimeOverrides.createdById],
    references: [user.id],
  }),
}))
