-- admin-v1 §18.1 — comms consent / do-not-contact flag (DPA). Default false
-- (contactable); enforced server-side at every send point (§13.3 / §17.2).
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "doNotContact" boolean DEFAULT false NOT NULL;
