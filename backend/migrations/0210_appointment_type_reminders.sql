-- Create `appointment_type_reminders`.
--
-- The table was declared in `schema/comms.ts` and wired up end to end — the
-- `/api/appointment-type-reminders` routes, `handleOnBookingReminders()` and the
-- scheduler's `processAppointmentTypeReminders()` all query it — but no migration
-- ever emitted the DDL, so it exists in NO environment. Every one of those code
-- paths is a `relation "appointment_type_reminders" does not exist` away from a
-- 500 (the scheduler tick swallows it as a logged error and silently sends no
-- reminders at all). Caught by `pnpm --filter backend db:drift`.
--
-- Column names are quoted camelCase to match the Drizzle declaration; this table
-- follows the sibling `reminder_templates`/`scheduled_reminders` convention, NOT
-- the snake_case outlier in `accounts`.

CREATE TABLE IF NOT EXISTS "appointment_type_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	-- NULL = the global default policy, applied to any type with no explicit rule
	"appointmentTypeId" uuid,
	"triggerType" text NOT NULL, -- 'on_booking' | 'before_appointment'
	"offsetHours" integer,       -- NULL for 'on_booking'
	"templateId" uuid NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- The FK guards work in two directions. `DROP CONSTRAINT IF EXISTS` clears a
-- constraint left behind by a previous run of THIS migration (the sanctioned
-- H16 guard — see tests/integration/migrations.test.ts). The `pg_constraint`
-- check then looks for ANY foreign key on the column, not just one by that
-- name: the table was hand-applied to at least one environment with
-- `fk_<table>_<column>` names, and a name-only guard would add a second,
-- redundant FK there (every insert would re-check the same parent twice).

ALTER TABLE "appointment_type_reminders"
  DROP CONSTRAINT IF EXISTS "appointment_type_reminders_appointmentTypeId_fkey";
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = '"appointment_type_reminders"'::regclass
      AND c.contype = 'f'
      AND a.attname = 'appointmentTypeId'
  ) THEN
    ALTER TABLE "appointment_type_reminders"
      ADD CONSTRAINT "appointment_type_reminders_appointmentTypeId_fkey"
      FOREIGN KEY ("appointmentTypeId") REFERENCES "public"."appointment_types"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "appointment_type_reminders"
  DROP CONSTRAINT IF EXISTS "appointment_type_reminders_templateId_fkey";
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = '"appointment_type_reminders"'::regclass
      AND c.contype = 'f'
      AND a.attname = 'templateId'
  ) THEN
    ALTER TABLE "appointment_type_reminders"
      ADD CONSTRAINT "appointment_type_reminders_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "public"."reminder_templates"("id");
  END IF;
END $$;
--> statement-breakpoint

-- Every read filters on (appointmentTypeId, triggerType) with isActive: the
-- per-type lookup on booking, the IS NULL default lookup, and the scheduler's
-- 15-minute tick.
CREATE INDEX IF NOT EXISTS "appointment_type_reminders_type_trigger_idx"
  ON "appointment_type_reminders" ("appointmentTypeId", "triggerType", "isActive");
