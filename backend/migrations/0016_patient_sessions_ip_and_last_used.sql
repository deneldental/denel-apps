-- Add ipAddress and lastUsedAt to patient_sessions.
-- ipAddress: captures the client IP at session creation for the sessions management UI.
-- lastUsedAt: updated on each authenticated request so patients can see active sessions.

ALTER TABLE "patient_sessions" ADD COLUMN "ipAddress" text;
ALTER TABLE "patient_sessions" ADD COLUMN "lastUsedAt" timestamp DEFAULT now() NOT NULL;
