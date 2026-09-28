-- Migration 0076: assigned doctor on lab cases
--
-- Every lab case (internal or external) gets a clinical doctor assigned by us.
-- This is distinct from referringDoctorId (the EXTERNAL doctor who sent us the
-- case) and from assignedTechnicianId (the lab tech running the work).
--
-- For internal cases: this is the patient's primary doctor handling the case.
-- For external cases: this is whichever of our doctors signs off on it.
-- FK to user.id so existing doctor users are valid targets.

ALTER TABLE "lab_cases"
  ADD COLUMN IF NOT EXISTS "assignedDoctorId" text REFERENCES "user"("id") ON DELETE SET NULL;
