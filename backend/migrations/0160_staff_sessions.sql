-- Staff phone+OTP auth (Phase 1): custom server-stored sessions for the staff
-- PWA, separate from Better Auth (which still powers portal/HR/reports). Mirrors
-- patient_sessions; keyed by user.id so getCurrentUser resolves the same user.
CREATE TABLE IF NOT EXISTS "staff_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "tokenHash" text NOT NULL UNIQUE,
  "expiresAt" timestamp NOT NULL,
  "userAgent" text,
  "ipAddress" text,
  "lastUsedAt" timestamp DEFAULT now() NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_sessions_user_idx" ON "staff_sessions" ("userId");
