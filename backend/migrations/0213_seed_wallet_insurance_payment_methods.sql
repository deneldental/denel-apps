-- Seed real `payment_methods` rows for "wallet" and "insurance" so they are
-- admin-manageable from Settings → Finance & Billing → Payment Methods,
-- instead of being unconditionally hardcoded into every <PaymentMethodSelect>
-- via the `includeWallet` / `includeInsurance` props.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- <PaymentMethodSelect> used to append synthetic "Insurance" / "Wallet
-- credit" items whenever the lookup had no row named `insurance` / `wallet`,
-- bypassing the admin's Payment Methods table entirely for those two
-- options — an admin could not rename or deactivate them. That synthetic
-- fallback is now removed from the component; this migration seeds the two
-- rows it used to fabricate so the wallet-credit and insurance-claim payment
-- flows keep working everywhere they're used (ReceivePaymentDialog,
-- CheckInPaymentDialog, ConfirmEstimateSheet) without a behaviour regression.
--
-- `glAccountCode` is pinned to the same GL channel `METHOD_TO_CODE` in
-- lib/channel-accounts.ts already used as the fallback for these two slugs
-- (insurance → 1210, wallet → 2200), so GL posting is unchanged.
--
-- Idempotent: `ON CONFLICT (name) DO NOTHING` — a clinic that already
-- created its own "wallet" / "insurance" row (any casing quirk aside) is
-- left untouched.

INSERT INTO "payment_methods" ("name", "displayName", "isActive", "glAccountCode")
VALUES
  ('wallet', 'Wallet credit', true, '2200'),
  ('insurance', 'Insurance', true, '1210')
ON CONFLICT ("name") DO NOTHING;
