-- admin-v1 Phase 4 — link each expense category to a GL expense account so a paid
-- expense can post DR <category's expense account> / CR <cash/MoMo channel>.
-- Nullable: an unmapped category records operationally but won't post until mapped.
ALTER TABLE "expense_categories"
  ADD COLUMN IF NOT EXISTS "account_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "expense_categories"
    ADD CONSTRAINT "expense_categories_account_id_accounts_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
