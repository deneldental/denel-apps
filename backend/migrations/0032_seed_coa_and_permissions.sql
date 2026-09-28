-- 0032_seed_coa_and_permissions.sql
-- Phase 1 — seed the default Chart of Accounts and the new finance
-- permissions. All inserts are idempotent.

BEGIN;

-- ── Permissions ──────────────────────────────────────────────────────────────
INSERT INTO "permissions" ("module", "action", "description")
VALUES
  ('accounts',          'read',   'View the chart of accounts'),
  ('accounts',          'create', 'Create new accounts'),
  ('accounts',          'update', 'Edit account details'),
  ('accounts',          'delete', 'Deactivate accounts'),
  ('journal_entries',   'read',   'View journal entries and lines'),
  ('journal_entries',   'create', 'Post manual journal entries'),
  ('journal_entries',   'update', 'Annotate journal entries'),
  ('journal_entries',   'delete', 'Reverse journal entries'),
  ('periods',           'read',   'View accounting periods'),
  ('periods',           'create', 'Create accounting periods'),
  ('periods',           'update', 'Close or reopen accounting periods'),
  ('periods',           'delete', 'Delete accounting periods')
ON CONFLICT ("module", "action") DO NOTHING;

-- ── Chart of Accounts ────────────────────────────────────────────────────────
-- Code, name, type, subtype, is_control, control_party_type, normal_balance.
INSERT INTO "accounts" ("code", "name", "type", "subtype", "is_control", "control_party_type", "normal_balance")
VALUES
  -- Assets
  ('1000', 'Cash on Hand',                       'asset',     'Current',     false, NULL,         'debit'),
  ('1010', 'Bank Account — Main',                'asset',     'Current',     false, NULL,         'debit'),
  ('1020', 'Mobile Money — MTN',                 'asset',     'Current',     false, NULL,         'debit'),
  ('1021', 'Mobile Money — Vodafone',            'asset',     'Current',     false, NULL,         'debit'),
  ('1030', 'Card Processor Receivable',          'asset',     'Current',     false, NULL,         'debit'),
  ('1200', 'Accounts Receivable — Patients',     'asset',     'Current',     true,  'patient',    'debit'),
  ('1210', 'Accounts Receivable — Insurance',    'asset',     'Current',     true,  'insurance',  'debit'),
  ('1500', 'Equipment',                          'asset',     'Fixed',       false, NULL,         'debit'),
  ('1510', 'Accumulated Depreciation',           'asset',     'Contra-Fixed',false, NULL,         'credit'),

  -- Liabilities
  ('2000', 'Accounts Payable — Suppliers',       'liability', 'Current',     true,  'supplier',   'credit'),
  ('2100', 'Commission Payable — Specialists',   'liability', 'Current',     true,  'specialist', 'credit'),
  ('2200', 'Patient Deposits (Unapplied)',       'liability', 'Current',     true,  'patient',    'credit'),
  ('2300', 'VAT Payable',                        'liability', 'Current',     false, NULL,         'credit'),
  ('2310', 'NHIL/GETFund Payable',               'liability', 'Current',     false, NULL,         'credit'),
  ('2320', 'Withholding Tax Payable',            'liability', 'Current',     false, NULL,         'credit'),

  -- Equity
  ('3000', 'Owner''s Capital',                   'equity',    NULL,          false, NULL,         'credit'),
  ('3100', 'Retained Earnings',                  'equity',    NULL,          false, NULL,         'credit'),

  -- Revenue
  ('4100', 'Revenue — Diagnostic',               'revenue',   'Operating',   false, NULL,         'credit'),
  ('4110', 'Revenue — Preventive',               'revenue',   'Operating',   false, NULL,         'credit'),
  ('4120', 'Revenue — Restorative',              'revenue',   'Operating',   false, NULL,         'credit'),
  ('4130', 'Revenue — Endodontics',              'revenue',   'Operating',   false, NULL,         'credit'),
  ('4140', 'Revenue — Periodontics',             'revenue',   'Operating',   false, NULL,         'credit'),
  ('4150', 'Revenue — Oral Surgery',             'revenue',   'Operating',   false, NULL,         'credit'),
  ('4160', 'Revenue — Orthodontics',             'revenue',   'Operating',   false, NULL,         'credit'),
  ('4170', 'Revenue — Prosthodontics',           'revenue',   'Operating',   false, NULL,         'credit'),
  ('4180', 'Revenue — Cosmetic',                 'revenue',   'Operating',   false, NULL,         'credit'),
  ('4900', 'Discounts Given (Contra-Revenue)',   'revenue',   'Contra',      false, NULL,         'debit'),

  -- Expenses
  ('5100', 'Salaries Expense',                   'expense',   'Operating',   false, NULL,         'debit'),
  ('5110', 'Specialist Commission Expense',      'expense',   'Operating',   false, NULL,         'debit'),
  ('5200', 'Dental Supplies',                    'expense',   'Operating',   false, NULL,         'debit'),
  ('5210', 'Lab Fees',                           'expense',   'Operating',   false, NULL,         'debit'),
  ('5300', 'Rent Expense',                       'expense',   'Operating',   false, NULL,         'debit'),
  ('5310', 'Utilities Expense',                  'expense',   'Operating',   false, NULL,         'debit'),
  ('5400', 'Marketing Expense',                  'expense',   'Operating',   false, NULL,         'debit'),
  ('5500', 'Depreciation Expense',               'expense',   'Operating',   false, NULL,         'debit'),
  ('5900', 'Bad Debt Expense',                   'expense',   'Operating',   false, NULL,         'debit')
ON CONFLICT ("code") DO NOTHING;

-- ── Seed an initial open period covering the current month ───────────────────
INSERT INTO "accounting_periods" ("name", "start_date", "end_date", "status")
VALUES (
  to_char(date_trunc('month', CURRENT_DATE), 'YYYY-MM'),
  date_trunc('month', CURRENT_DATE)::date,
  (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date,
  'open'
)
ON CONFLICT ("start_date", "end_date") DO NOTHING;

COMMIT;
