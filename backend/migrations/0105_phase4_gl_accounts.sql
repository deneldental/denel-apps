-- admin-v1 Phase 4 — Chart-of-Accounts foundation for the GL postings that follow
-- (retail sales + inventory/COGS §11.5/§12.2, payroll §14.1). Idempotent.
INSERT INTO "accounts" ("code", "name", "type", "subtype", "is_control", "control_party_type", "normal_balance")
VALUES
  ('1400', 'Inventory',                'asset',     'Current',       false, NULL, 'debit'),
  ('4200', 'Retail Sales Revenue',     'revenue',   'Operating',     false, NULL, 'credit'),
  ('5000', 'Cost of Goods Sold',       'expense',   'Cost of Sales', false, NULL, 'debit'),
  ('2330', 'PAYE Payable',             'liability', 'Current',       false, NULL, 'credit'),
  ('2340', 'SSNIT Payable',            'liability', 'Current',       false, NULL, 'credit'),
  ('5120', 'SSNIT Employer Expense',   'expense',   'Operating',     false, NULL, 'debit')
ON CONFLICT ("code") DO NOTHING;
