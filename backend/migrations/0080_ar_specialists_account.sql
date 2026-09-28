-- Migration 0080: AR — Specialists control account (Phase 3)
--
-- Phase 3 introduces specialist-billed invoices (external lab cases, where
-- the referring doctor pays). The existing AR account 1200 has
-- control_party_type='patient' and rejects journal lines with
-- party_type='specialist', so we need a dedicated AR control account for
-- specialist debtors.

INSERT INTO "accounts" ("code", "name", "type", "subtype", "is_control", "control_party_type", "normal_balance", "is_active")
VALUES (
  '1220',
  'Accounts Receivable — Specialists',
  'asset',
  'Current',
  true,
  'specialist',
  'debit',
  true
)
ON CONFLICT (code) DO NOTHING;
