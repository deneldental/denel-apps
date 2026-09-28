-- Schema catch-up: the handful of things the drizzle schema declares that
-- migrations 0001–0186 never created.
--
-- This file was originally a `drizzle-kit generate` full-schema baseline: 141
-- CREATE TABLEs, 224 ADD CONSTRAINTs and a pile of DROP COLUMNs, emitted
-- because the snapshot chain in meta/ is incomplete (0183 → 0187 skips ~100
-- migrations' worth of state, so drizzle diffed the schema against a view of
-- the database that stopped being true around 0017). Against any database that
-- actually ran 0001–0186 it dies on its first statement — `relation
-- "accounting_periods" already exists` — and it carries drops (`recalls`,
-- `patients.type`, `staff.role`, …) that the real migrations already handled.
--
-- Diffed statement by statement against a database at 0186, only the following
-- were genuine changes. Everything else in the generated file was a no-op: 139
-- tables already present, 181 columns already added, 221 foreign keys already
-- enforced under drizzle-era names, and 16 drops whose targets are long gone.
--
-- Deliberately NOT carried over:
--   * anything touching "products" / "inventory" — both dropped in 0102 when
--     the catalogue collapsed into "items". The generator still emits them
--     because src/db/schema/inventory.ts declares tables that no longer exist.
--   * renaming "role_scopes_pkey" → "role_scopes_roleId_interface_scope_pk"
--     (and the user_scopes twin). Both primary keys already cover exactly the
--     right columns; only the drizzle-style name is missing.
--   * "payslips_staff_period_idx" / "staff_attendance_staff_date_idx" — the
--     same uniqueness is already enforced by *_key constraints plus idx_*
--     indexes on the same columns. A third copy buys nothing.
--   * UNIQUE constraints on "user"."username", "doctors"."specialistId" and
--     "staff"."deviceUserId". All three are already enforced as bare unique
--     indexes (the doctors one partial, WHERE "specialistId" IS NOT NULL);
--     promoting an index to a constraint changes nothing a query can observe,
--     and the first two names collide with the existing indexes outright.
--
-- Every statement below is guarded, so this is safe to re-run and safe on a
-- database that already received some of it.

-- ── Cases ──────────────────────────────────────────────────────────────────
-- A case points at the treatment plan that is its clinical content; a stage
-- points at the plan item it fulfils. 0188 backfills a case per orphan plan
-- and needs "planId" to exist first.
ALTER TABLE "patient_cases" ADD COLUMN IF NOT EXISTS "planId" uuid;
ALTER TABLE "case_stages" ADD COLUMN IF NOT EXISTS "planItemId" uuid;

-- Deleting a plan must not delete the case history that referenced it.
DO $$ BEGIN
  ALTER TABLE "patient_cases"
    ADD CONSTRAINT "patient_cases_planId_treatment_plans_id_fk"
    FOREIGN KEY ("planId") REFERENCES "public"."treatment_plans"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "case_stages"
    ADD CONSTRAINT "case_stages_planItemId_treatment_plan_items_id_fk"
    FOREIGN KEY ("planItemId") REFERENCES "public"."treatment_plan_items"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Document signing ───────────────────────────────────────────────────────
-- "document_instances" shipped with signers denormalised into a jsonb column,
-- which cannot express per-signer status, order or audit trail. These two
-- tables are the normalised form the schema now declares.
ALTER TABLE "document_instances" ADD COLUMN IF NOT EXISTS "signingOrder" text DEFAULT 'SEQUENTIAL';

CREATE TABLE IF NOT EXISTS "document_signers" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instanceId"        uuid NOT NULL,
  "order"             integer NOT NULL,
  "name"              text NOT NULL,
  "email"             text NOT NULL,
  "status"            text DEFAULT 'PENDING' NOT NULL,
  "signedAt"          timestamp,
  "ipAddress"         text,
  "userAgent"         text,
  "signatureImageUrl" text,
  "createdAt"         timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "document_fields" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instanceId" uuid NOT NULL,
  "signerId"   uuid NOT NULL,
  "type"       text NOT NULL,
  "page"       integer NOT NULL,
  "x"          real NOT NULL,
  "y"          real NOT NULL,
  "w"          real NOT NULL,
  "h"          real NOT NULL,
  "value"      text
);

-- Signers and fields have no meaning apart from their document, so they go
-- with it; a field likewise goes with the signer it belongs to.
DO $$ BEGIN
  ALTER TABLE "document_signers"
    ADD CONSTRAINT "document_signers_instanceId_document_instances_id_fk"
    FOREIGN KEY ("instanceId") REFERENCES "public"."document_instances"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "document_fields"
    ADD CONSTRAINT "document_fields_instanceId_document_instances_id_fk"
    FOREIGN KEY ("instanceId") REFERENCES "public"."document_instances"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "document_fields"
    ADD CONSTRAINT "document_fields_signerId_document_signers_id_fk"
    FOREIGN KEY ("signerId") REFERENCES "public"."document_signers"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Patient tags ───────────────────────────────────────────────────────────
-- System tags are seeded by the app and must not be editable or deletable in
-- the tag admin UI; existing rows are all user-created, so false is correct.
ALTER TABLE "patient_tags" ADD COLUMN IF NOT EXISTS "isSystem" boolean DEFAULT false NOT NULL;

-- ── Foreign keys never carried over from earlier hand-written migrations ───
-- Both columns already hold only valid user ids, and both null out rather than
-- cascade: losing a user must not delete a paired kiosk or a tax configuration.
DO $$ BEGIN
  ALTER TABLE "kiosk_devices"
    ADD CONSTRAINT "kiosk_devices_pairedById_user_id_fk"
    FOREIGN KEY ("pairedById") REFERENCES "public"."user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "tax_configurations"
    ADD CONSTRAINT "tax_configurations_createdById_user_id_fk"
    FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Invoice lifecycle ──────────────────────────────────────────────────────
-- An invoice is now born as a draft and becomes 'issued' when it is posted;
-- 'pending' is not a state the current lifecycle produces. Default only —
-- existing rows keep whatever status they already carry.
ALTER TABLE "invoices" ALTER COLUMN "status" SET DEFAULT 'draft';
