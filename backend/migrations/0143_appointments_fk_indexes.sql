-- 0143_appointments_fk_indexes.sql — index the unindexed FKs on `appointments`.
--
-- `patientId` and `doctorId` are the hottest filters on this table and were
-- previously seq-scanned (the only existing indexes are appointments_chair_date_idx
-- and appointments_clinic_id_idx). The doctor index is composite with `date` to
-- cover the common "this doctor's appointments in a window" query.
--
-- Hand-written, idempotent (CREATE INDEX IF NOT EXISTS), no breakpoint markers
-- (runs as one transaction per the migrate.mjs runner).
CREATE INDEX IF NOT EXISTS "appointments_patient_idx" ON "appointments" ("patientId");
CREATE INDEX IF NOT EXISTS "appointments_doctor_date_idx" ON "appointments" ("doctorId","date");
