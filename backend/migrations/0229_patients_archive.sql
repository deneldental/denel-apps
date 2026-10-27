-- Give `patients` an archive (soft-delete) trio, mirroring `invoices`/
-- `payment_plans`' archived/archivedAt/archivedBy convention.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- Patient records had no soft-delete: the old `DELETE /api/patients/:id`
-- hard-deleted the row, cascading through every appointment, invoice,
-- payment, medical record and timeline entry ever tied to that patient —
-- a single click destroyed the clinic's entire financial and clinical
-- history for that person, with no way back. See
-- project-docs/patient-records-and-scheduling-audit.md, finding C5.
--
-- This is the `invoices`/`payment_plans` convention, not `patient_cases`'
-- `deletedAt`-only one: it needed a working restore path, which only the
-- invoices convention already had proven (POST /:id/archive, POST
-- /:id/unarchive, DELETE /:id/permanent — the last gated by
-- lib/archive.ts's shared `verifyAdminPassword`).
--
-- ─── What this does, and does NOT, do ──────────────────────────────────
-- SCHEMA ONLY. No backfill needed — every existing patient defaults to
-- `archived = false`, i.e. still active/visible, exactly as before this
-- migration. Idempotent: `ADD COLUMN IF NOT EXISTS`, and the FK is
-- guarded by the DO-block's `duplicate_object` catch so re-running is
-- safe. The runner wraps each migration in its own transaction, so this
-- file carries no explicit BEGIN/COMMIT.

ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "archived" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "archivedAt" timestamp;
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "archivedBy" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patients" ADD CONSTRAINT "patients_archivedBy_user_id_fk" FOREIGN KEY ("archivedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
