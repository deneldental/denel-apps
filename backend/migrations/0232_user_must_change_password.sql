-- F20 (DENEL_FRAMADA_AUDIT_2026-10-25.md, Step 6, decision D8): a password an admin
-- sets for someone else must be changed by that person before anything else.
--
-- A flag on the USER, because the people who get an admin-set password are not all
-- staff: a doctor made from the portal's Add Specialist sheet has no `staff` row at
-- all, so `staff.isFirstLogin` (which nothing reads and nothing clears) cannot carry it.
--
-- Defaults to false, so nobody who can sign in today is locked out by this deploy.
-- The backend sets it wherever an admin writes a credential for another person and
-- clears it when that person changes the password themselves.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "mustChangePassword" boolean NOT NULL DEFAULT false;
