-- Multi-tenancy preparation: add clinicId to the four core patient-facing tables.
--
-- The column is nullable so existing rows are unaffected. When multi-tenancy is
-- activated, a backfill will set clinicId to the single clinic's UUID and the
-- column will be made NOT NULL with a foreign key to a future clinics table.
--
-- Downstream code should NOT filter on clinicId yet — it is a no-op placeholder.

ALTER TABLE "patients"     ADD COLUMN IF NOT EXISTS "clinicId" uuid;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "clinicId" uuid;
ALTER TABLE "invoices"     ADD COLUMN IF NOT EXISTS "clinicId" uuid;
ALTER TABLE "payments"     ADD COLUMN IF NOT EXISTS "clinicId" uuid;

-- Index each column so the future WHERE clinicId = $1 predicate can be
-- satisfied with an index scan from day one.
CREATE INDEX IF NOT EXISTS "patients_clinic_id_idx"     ON "patients"     ("clinicId");
CREATE INDEX IF NOT EXISTS "appointments_clinic_id_idx" ON "appointments" ("clinicId");
CREATE INDEX IF NOT EXISTS "invoices_clinic_id_idx"     ON "invoices"     ("clinicId");
CREATE INDEX IF NOT EXISTS "payments_clinic_id_idx"     ON "payments"     ("clinicId");
