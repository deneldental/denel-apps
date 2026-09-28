-- Phase 1 — Memo audience targeting + read receipts.
--
-- Adds `audienceFilter` (structured JSONB) to staff_memos so memos can be
-- targeted at specific roles, departments, or staff IDs instead of the
-- free-text `audience` field. The text field is kept as a human-readable
-- summary so existing memos remain legible.
--
-- Introduces `staff_memo_acknowledgements` (memoId, staffId, acknowledgedAt)
-- with a unique constraint on (memoId, staffId). One row per first-open
-- drives the "Read by X / Y" indicator on the admin memo list.
--
-- Both changes are additive and idempotent.

ALTER TABLE "staff_memos"
  ADD COLUMN IF NOT EXISTS "audienceFilter" jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "staff_memo_acknowledgements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "memoId" uuid NOT NULL,
  "staffId" uuid NOT NULL,
  "acknowledgedAt" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "staff_memo_acknowledgements" DROP CONSTRAINT IF EXISTS "staff_memo_ack_memoId_fk";
ALTER TABLE "staff_memo_acknowledgements"
  ADD CONSTRAINT "staff_memo_ack_memoId_fk"
  FOREIGN KEY ("memoId") REFERENCES "staff_memos"("id") ON DELETE CASCADE;

ALTER TABLE "staff_memo_acknowledgements" DROP CONSTRAINT IF EXISTS "staff_memo_ack_staffId_fk";
ALTER TABLE "staff_memo_acknowledgements"
  ADD CONSTRAINT "staff_memo_ack_staffId_fk"
  FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "staff_memo_ack_unique_idx"
  ON "staff_memo_acknowledgements" ("memoId", "staffId");

CREATE INDEX IF NOT EXISTS "staff_memo_ack_memo_idx"
  ON "staff_memo_acknowledgements" ("memoId");
