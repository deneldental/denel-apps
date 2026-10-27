-- One row per (appointment, policy) `before_appointment` reminder actually
-- sent — the idempotency record `processAppointmentTypeReminders` was
-- missing.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- Unlike `scheduled_reminders` (one row per reminder, stamped via its own
-- `lastRunAt`), a `before_appointment` appointment-type policy fires against
-- many appointments per scheduler tick, so there was no single column to
-- stamp. The code's own comment admitted the gap: "this could double-fire if
-- the scheduler is rerun manually within 15 mins." See
-- project-docs/patient-records-and-scheduling-audit.md, H3.
--
-- The unique index on (appointmentId, policyId) is what makes a duplicate
-- send impossible rather than merely unlikely: `processAppointmentTypeReminders`
-- now inserts a row here right after a successful send, with
-- `ON CONFLICT DO NOTHING`, and filters its own candidate list against this
-- table first — so a second run (manual re-trigger, overlapping tick, process
-- restart mid-window) sees the row already there and skips.
--
-- ─── What this does, and does NOT, do ──────────────────────────────────
-- SCHEMA ONLY. No backfill — every already-sent `before_appointment` reminder
-- before this migration has no row here, so this migration cannot retroactively
-- prevent a double-send that already happened; it only prevents new ones from
-- this point on. Idempotent: `CREATE TABLE IF NOT EXISTS` / `CREATE UNIQUE INDEX
-- IF NOT EXISTS`, and the FK additions are guarded by the DO-block's
-- `duplicate_object` catch.

CREATE TABLE IF NOT EXISTS "appointment_type_reminder_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointmentId" uuid NOT NULL,
	"policyId" uuid NOT NULL,
	"sentAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_type_reminder_sends" ADD CONSTRAINT "appt_type_reminder_sends_appointment_id_fk" FOREIGN KEY ("appointmentId") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_type_reminder_sends" ADD CONSTRAINT "appt_type_reminder_sends_policy_id_fk" FOREIGN KEY ("policyId") REFERENCES "public"."appointment_type_reminders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appt_type_reminder_sends_appt_policy_uniq"
  ON "appointment_type_reminder_sends" ("appointmentId", "policyId");
