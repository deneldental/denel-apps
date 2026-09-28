-- Migration 0025: Attendance admin — per-staff recurring off-days + clinic holidays
-- Excuses already use attendance_exceptions (added in 0023).

CREATE TABLE IF NOT EXISTS "staff_off_days" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId"     UUID NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "dayOfWeek"   INTEGER NOT NULL CHECK ("dayOfWeek" BETWEEN 0 AND 6),
  "reason"      TEXT,
  "createdById" TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "staff_off_days_unique" UNIQUE ("staffId", "dayOfWeek")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_off_days_staff_idx" ON "staff_off_days"("staffId");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "clinic_holidays" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "date"        DATE NOT NULL,
  "name"        TEXT NOT NULL,
  "createdById" TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "clinic_holidays_unique_date" UNIQUE ("date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clinic_holidays_date_idx" ON "clinic_holidays"("date");
