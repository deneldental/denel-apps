-- G01 (DENEL_FRAMADA_AUDIT_2026-10-25.md, Step 10): first-unit / additional-unit tariff.
--
-- An application type (the unit a service is billed against: arch, quadrant, tooth, …) can be billed
-- in steps: the service's price for the first unit, its own price for each further one. Two columns
-- carry it:
--
--   application_scopes."additionalUnitPriceEnabled"  the type's switch (off for every existing type)
--   services."additionalUnitPrice"                    pesewas for each unit after the first; NULL = none
--
-- Both default to "off", so this migration changes no price: a line is stepped only when an admin
-- has turned its type on AND given its service an additional-unit price. An invoice already raised
-- is never recomputed; its lines hold the amounts they were billed at.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. The runner wraps the file in its own transaction.

ALTER TABLE "application_scopes" ADD COLUMN IF NOT EXISTS "additionalUnitPriceEnabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "additionalUnitPrice" integer;
