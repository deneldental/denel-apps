-- D1 — map expense categories to GL accounts so expenses actually post.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- `ensureExpensePosted()` (lib/expense-service.ts) resolves a paid expense's GL
-- account from its category. When the category carries no `account_id` it
-- returns `unmapped_category` and books nothing — operationally recorded, but
-- invisible to the ledger. Migration 0106 introduced the column and said as
-- much; only `Communications` was ever mapped (0127). Every other category was
-- left NULL, so `journal_entries` held ZERO rows with
-- `source_doc_type = 'expense'` and every GL-sourced report understated cost and
-- overstated margin (August reported `marginPct: 100`).
--
-- ─── What this does, and does NOT, do ───────────────────────────────────
-- Seeds the mapping ONLY. It deliberately does not post the ~GH₵40,505 backlog:
-- that runs through `PUT /api/expenses/categories/:id/account` →
-- `backfillCategory()`, which carries an audit trail and respects the period
-- gate. A bulk backfill in SQL would have neither.
--
-- Two consequences for whoever files the backlog afterwards:
--   • entries post at `expense.date`, i.e. into Feb–Jul 2026. Those periods are
--     open today — backfill BEFORE closing them or it needs an admin reopen.
--   • it restates five months of already-reported figures. That is the point,
--     but it should be a conscious, dated action.
--
-- ─── Matching ───────────────────────────────────────────────────────────
-- Categories are matched with `lower(trim(...))`, mirroring
-- `resolveExpenseAccountId()` exactly, so the seed is insensitive to whatever
-- casing or padding the live rows carry.
--
-- Fully idempotent. Every write is guarded (ON CONFLICT DO NOTHING / NOT EXISTS
-- / `account_id IS NULL`), so a re-run is a no-op and an admin's later re-map is
-- never clobbered. The runner wraps each migration in its own transaction, so
-- this file carries no explicit BEGIN/COMMIT.
--
-- NOT mapped here, deliberately: `water` and `trach_collection`. Neither has
-- unposted rows, and `trach_collection` appears in no migration or seed — both
-- need identifying before they get a GL home.

-- ── 1. Two new expense accounts ──────────────────────────────────────
-- `equipment`, `errands` and `other` had no natural home in the seeded chart
-- (0032). 5320 slots between 5310 Utilities and 5400 Marketing; 5700 between
-- 5620 CIT and 5810 Loss on Disposal. Both codes were free.
-- NOTE: `accounts` is fully snake_case, unlike its mixed-case sibling tables.
INSERT INTO "accounts" ("code", "name", "type", "subtype", "is_control", "control_party_type", "normal_balance")
VALUES
  ('5320', 'Repairs & Maintenance',     'expense', 'Operating', false, NULL, 'debit'),
  ('5700', 'General & Administrative',  'expense', 'Operating', false, NULL, 'debit')
ON CONFLICT ("code") DO NOTHING;

-- ── 2. The missing `lab_work` category row ──────────────────────────────
-- Expenses were filed under this category but no `expense_categories` row ever
-- existed, so there was nothing to hang an account on. Guarded on a
-- case-insensitive match rather than `ON CONFLICT (name)` so a row that already
-- exists under different casing is not duplicated (the unique index is on the
-- exact string; `resolveExpenseAccountId` is not).
INSERT INTO "expense_categories" ("name", "displayName", "isActive")
SELECT 'lab_work', 'Lab Work', true
WHERE NOT EXISTS (
  SELECT 1 FROM "expense_categories" WHERE lower(trim("name")) = 'lab_work'
);

-- ── 3. Map every category with an unposted backlog ───────────────────────
-- `account_id IS NULL` keeps a later admin re-map safe from a re-run.
UPDATE "expense_categories" ec
SET "account_id" = a.id, "updatedAt" = now()
FROM (VALUES
  ('supplies',  '5200'),  -- Dental Supplies
  ('utilities', '5310'),  -- Utilities Expense
  ('rent',      '5300'),  -- Rent Expense
  ('payroll',   '5100'),  -- Salaries Expense
  ('marketing', '5400'),  -- Marketing Expense
  ('lab_work',  '5210'),  -- Lab Fees
  ('equipment', '5320'),  -- Repairs & Maintenance  (new above)
  ('errands',   '5700'),  -- General & Administrative (new above)
  ('other',     '5700')   -- General & Administrative (new above)
) AS m(category, code)
JOIN "accounts" a ON a."code" = m.code
WHERE lower(trim(ec."name")) = m.category
  AND ec."account_id" IS NULL;
