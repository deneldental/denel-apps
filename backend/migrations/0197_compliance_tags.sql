-- compliance_tags — declared in the schema, wired into live code, never migrated.
--
-- `complianceTags` (backend/src/db/schema/settings-lookup.ts:156) is registered in
-- the lookup map at backend/src/routes/lookups.ts:72 as 'compliance-tags', so the
-- ORM emits SQL against a table that does not exist and the lookup 500s at runtime.
--
-- Same defect class as lab_services.clinicPrice (0195): schema-declared, never
-- migrated, undetected until an endpoint failed. Found by the schema-drift check
-- (`pnpm --filter backend db:drift`).
--
-- Structure mirrors the sibling lookup tables created in 0179 (specialties).
-- Left unseeded deliberately — the clinic's compliance tag set is not known here,
-- and an empty lookup is correct behaviour, unlike a wrong one.

CREATE TABLE IF NOT EXISTS "compliance_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "compliance_tags_active_idx" ON "compliance_tags" ("is_active");
