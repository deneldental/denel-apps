-- admin-v1 §4.F6 — Chart-of-Accounts foundation for the Fixed Asset register.
--
-- The depreciation + prepaid-amortization postings (fixed-asset-service.ts) need
-- four GL accounts. Three already exist from the Phase-1 seed (migration 0032):
--   1500 Equipment (asset, Fixed)            — the "Fixed Assets" capitalization account
--   1510 Accumulated Depreciation (contra)   — normal_balance = credit
--   5500 Depreciation Expense (expense)
-- so for those the INSERT is a no-op (ON CONFLICT (code) DO NOTHING). The only
-- genuinely new account is 1600 Prepaid Expenses (no 16xx code is taken — verified
-- against 0032 + 0105). Idempotent: re-running this migration changes nothing.
INSERT INTO "accounts" ("code", "name", "type", "subtype", "is_control", "control_party_type", "normal_balance")
VALUES
  ('1500', 'Equipment',                  'asset',   'Fixed',         false, NULL, 'debit'),
  ('1510', 'Accumulated Depreciation',   'asset',   'Contra-Fixed',  false, NULL, 'credit'),
  ('1600', 'Prepaid Expenses',           'asset',   'Current',       false, NULL, 'debit'),
  ('5500', 'Depreciation Expense',       'expense', 'Operating',     false, NULL, 'debit')
ON CONFLICT ("code") DO NOTHING;
