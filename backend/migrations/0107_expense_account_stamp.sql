-- admin-v1 Phase 4 (Option A) — stamp the resolved GL expense account onto each
-- expense at record time, so posting resolves by a stable id (immune to category
-- rename/re-map) rather than by the mutable category name.
ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "account_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "expenses"
    ADD CONSTRAINT "expenses_account_id_accounts_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
