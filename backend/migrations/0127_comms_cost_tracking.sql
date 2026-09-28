-- admin-v1 §13.5 — SMS / email cost tracking.
--
-- A send books its cost (units × rate) as an expense in a dedicated
-- "Communications" category that maps to the existing 5400 Marketing Expense GL
-- account, so it posts (DR 5400 / CR cash) through the standard expense pipeline
-- and flows into the §13.6 CRM digest + the financial statements.
--
-- Also seeds the admin-configurable per-unit rate defaults into the
-- clinic_settings KV (GHS): SMS 0.04, email 0.001. Admins can change these via
-- the settings store (settings-store.ts) without a code change.
--
-- Fully idempotent (ON CONFLICT DO NOTHING / guarded UPDATE) — safe to re-run.
-- The runner (migrate.mjs) wraps each migration in its own transaction, so this
-- file carries no explicit BEGIN/COMMIT (that would nest + close the txn early).

-- ── 1. The Communications expense category, mapped to 5400 Marketing ─────────
-- Insert the category (no-op if it already exists by name).
INSERT INTO "expense_categories" ("name", "displayName", "isActive")
VALUES ('Communications', 'Communications (SMS / Email)', true)
ON CONFLICT ("name") DO NOTHING;

-- Map it to the 5400 Marketing Expense account, but only if it isn't already
-- mapped (so a later admin re-map is never clobbered by a re-run). The 5400
-- account is seeded in 0032_seed_coa_and_permissions.sql.
UPDATE "expense_categories" ec
SET "account_id" = a.id, "updatedAt" = now()
FROM "accounts" a
WHERE ec."name" = 'Communications'
  AND ec."account_id" IS NULL
  AND a."code" = '5400';

-- ── 2. Per-unit cost rate defaults (clinic_settings KV) ──────────────────────
-- jsonb numeric values, read by settings-store.ts (getSmsCostPerUnit /
-- getEmailCostPerUnit). DO NOTHING preserves any admin-set value on re-run.
INSERT INTO "clinic_settings" ("key", "value")
VALUES
  ('settings:sms_cost_per_unit',   '0.04'::jsonb),
  ('settings:email_cost_per_unit', '0.001'::jsonb)
ON CONFLICT ("key") DO NOTHING;
