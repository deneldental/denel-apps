-- Migration 0022: HR attendance — events ingest + exceptions; staff.deviceUserId mapping

-- ── Staff: add deviceUserId column ────────────────────────────────────────────
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "deviceUserId" TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_deviceUserId_unique" ON "staff"("deviceUserId");
--> statement-breakpoint

-- ── Attendance events: raw clock swipes from the hardware reader CSV ──────────
CREATE TABLE IF NOT EXISTS "attendance_events" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId"         UUID REFERENCES "staff"("id") ON DELETE SET NULL,
  "deviceUserId"    TEXT NOT NULL,
  "deviceUserName"  TEXT,
  "eventTimestamp"  TIMESTAMPTZ NOT NULL,
  "deviceNo"        TEXT,
  "rawStatus"       TEXT,
  "sourceFile"      TEXT,
  "uploadedById"    TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "attendance_events_unique_event" UNIQUE ("deviceUserId", "eventTimestamp", "deviceNo", "rawStatus")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_events_staff_ts_idx" ON "attendance_events"("staffId", "eventTimestamp");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_events_device_user_idx" ON "attendance_events"("deviceUserId");
--> statement-breakpoint

-- ── Attendance exceptions: per-day overrides (excused absence, holiday, off-day)
CREATE TABLE IF NOT EXISTS "attendance_exceptions" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId"      UUID NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "date"         DATE NOT NULL,
  "type"         TEXT NOT NULL CHECK ("type" IN ('excused_absence', 'off_day', 'holiday')),
  "reason"       TEXT,
  "createdById"  TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "attendance_exceptions_unique" UNIQUE ("staffId", "date", "type")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_exceptions_staff_date_idx" ON "attendance_exceptions"("staffId", "date");
