-- Retire the last data statement of the `doctor-specialist-schema.ts`
-- self-heal into a real migration (D2, pairs with 0199).
--
-- Self-heal step 9 (`doctor-specialist-schema.ts:223`) back-fills
-- `invoices."planId"` from `payment_plans.invoice_id` on every boot. Like the
-- three statements in 0199 it is a one-shot data migration with no
-- `__applied_migrations` ledger entry and no audit trail — and it is the one
-- that writes to `invoices`, i.e. finance data.
--
-- WHY THIS IS ITS OWN MIGRATION AND NOT PART OF 0199:
-- it shares nothing with the doctors → specialists unification. Different
-- tables, different domain, different reviewers. The runner is transactional
-- per FILE, so folding it into 0199 would mean a failure in either half rolls
-- back the other, and a partial re-apply of one would be blocked by the ledger
-- entry of the other. Two files = two ledger tags = each backfill can be
-- verified, dated and reasoned about on its own. They are also independent, so
-- there is no ordering constraint between 0199 and 0200.
--
-- Statement copied VERBATIM from the self-heal, guard included and unchanged:
--   `i."planId" IS NULL` (plus the `pp.invoice_id = i.id` join)
-- so it only ever fills a NULL back-reference and never overwrites an existing
-- one — re-running matches zero rows. On every environment the self-heal has
-- already touched this is a no-op; it does real work only on a database built
-- from migrations alone.
--
-- Background: Phase-5 plans created BEFORE the `createPlan` back-reference fix
-- left their master invoice with a null `planId`. Without the back-reference
-- the plan → invoices relation returns an empty array and the progress UI
-- shows 0% paid even after real payments.
--
-- Prerequisites, both present long before this point on a migrations-only
-- database: `invoices."planId"` (0008) and `payment_plans.invoice_id` (0038).
--
-- The runner (migrate.mjs) wraps each migration in its own transaction, so
-- this file carries no explicit BEGIN/COMMIT (that would nest + close the txn
-- early).
--
-- This does NOT remove the self-heal. Per the D2 plan the scripts are deleted
-- only after these migrations are verified against dev AND production.

-- ── Backfill: invoices."planId" from payment_plans.invoice_id ────────────────

UPDATE invoices i
SET "planId" = pp.id, "updatedAt" = now()
FROM payment_plans pp
WHERE pp.invoice_id = i.id
  AND i."planId" IS NULL;
