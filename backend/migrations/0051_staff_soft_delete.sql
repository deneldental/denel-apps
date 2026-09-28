-- Phase 0 — Soft delete for `staff`.
--
-- Replaces the destructive `db.delete(staff)` path that cascaded into
-- staff_documents / staff_requests / performance_scores / staff_attendance /
-- payslips / staff_training_progress (all FK ON DELETE CASCADE). Accidental
-- deletions were unrecoverable and wiped audit-only data.
--
-- All list/find endpoints filter `deleted_at IS NULL` by default. A
-- `?includeDeleted=true` query param exposes soft-deleted rows for admin
-- recovery views.
--
-- This migration is additive (two nullable columns + a partial index). It is
-- safe to apply against production without backfilling existing rows.

ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedById" text;

-- FK is informational — `set null` so removing the deleting admin's user row
-- does not block recovery queries against this column. DROP-IF-EXISTS
-- guard makes the migration strictly idempotent on re-run.
ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_deletedById_user_id_fk";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_deletedById_user_id_fk"
  FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL;

-- Most list queries are `WHERE deletedAt IS NULL` — a partial index keeps
-- them cheap as soft-deleted rows accumulate.
CREATE INDEX IF NOT EXISTS "staff_active_idx"
  ON "staff" ("createdAt" DESC)
  WHERE "deletedAt" IS NULL;
