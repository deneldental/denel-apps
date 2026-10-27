-- Partial index on patients.pwaAccessEnabled — patient-records-and-scheduling-audit.md
-- LOW: "patient-auth.ts full-table-scans every PWA-enabled patient on every
-- patient-portal login/OTP/profile call instead of an indexed phone lookup."
--
-- The phone-matching itself (formatPhoneNumber normalization, matches either
-- the patient's own phone or a guardian's) stays in application code — stored
-- phone values aren't guaranteed to already be in normalized form, so an
-- exact-match SQL predicate on phone/guardianPhone risks silently missing a
-- patient whose number isn't canonically stored. This index targets the part
-- that's safe to fix without that risk: pwaAccessEnabled is a small, heavily
-- skewed minority of `patients` (portal access is opt-in per patient), so a
-- partial index turns findEnabledPatientsByPhone's initial filter into an
-- index scan instead of a full table scan as the table grows, before the
-- (already small) result set gets the JS-side phone comparison.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS "idx_patients_pwa_access_enabled"
  ON "patients" ("pwaAccessEnabled")
  WHERE "pwaAccessEnabled" = true;
