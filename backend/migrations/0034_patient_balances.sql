-- 0034_patient_balances.sql
-- Phase 2 — materialized patient AR + deposit balance.
-- Backfilled from current invoices.balance (AR) and patient_wallets.creditBalance
-- (deposits). Kept fresh by `patient-ar-service` on every posting.

BEGIN;

CREATE TABLE IF NOT EXISTS "patient_balances" (
  "patient_id"        uuid PRIMARY KEY REFERENCES "patients"("id") ON DELETE CASCADE,
  "ar_balance"        numeric(15, 2) NOT NULL DEFAULT 0,
  "deposit_balance"   numeric(15, 2) NOT NULL DEFAULT 0,
  "updated_at"        timestamp NOT NULL DEFAULT NOW()
);

-- Backfill AR from current invoice balances (only invoices currently
-- owed: issued, partially_paid).
INSERT INTO "patient_balances" ("patient_id", "ar_balance", "deposit_balance")
SELECT
  p.id,
  COALESCE((
    SELECT SUM(i.balance)
    FROM "invoices" i
    WHERE i."patientId" = p.id
      AND i.status IN ('issued', 'partially_paid')
  ), 0),
  COALESCE(w."creditBalance", 0)
FROM "patients" p
LEFT JOIN "patient_wallets" w ON w."patientId" = p.id
ON CONFLICT ("patient_id") DO UPDATE
SET ar_balance      = EXCLUDED.ar_balance,
    deposit_balance = EXCLUDED.deposit_balance,
    updated_at      = NOW();

COMMIT;
