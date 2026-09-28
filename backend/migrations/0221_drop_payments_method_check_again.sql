-- Drop `payments_method_check` again.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- Migration 0214 dropped this CHECK: payment methods are admin-configurable
-- (the `payment_methods` lookup, Settings → Finance & Billing), so a fixed
-- DB-level slug list rejected every custom method at INSERT.
--
-- What 0214 did not know: the startup self-heal in
-- `src/lib/doctor-specialist-schema.ts` (step 10, since removed) re-created
-- the constraint with its own 8-slug list on EVERY backend boot — so any
-- database whose backend started after 0214 ran has the constraint back, and
-- custom payment methods fail exactly as before. Found while adding the
-- lookup usage guards (settings-domain-audit B6).
--
-- With the self-heal step gone this drop finally sticks. On a database that
-- never booted the old self-heal it is a no-op.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS.

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
