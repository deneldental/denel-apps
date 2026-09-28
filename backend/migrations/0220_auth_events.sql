-- The authentication trail (audit finding M2).
--
-- Before this, nothing in the auth path wrote to audit_logs: no sign-in success
-- or failure, no sign-out, no OTP issue or verify, no password reset, no ban.
-- "Who signed in, from where, when" was unanswerable, credential stuffing was
-- undetectable, and a clinical-records compliance review had nothing to read.
--
-- Separate from audit_logs on purpose:
--   * audit_logs.userId is NOT NULL, so a failed sign-in for an unknown address
--     — the single most important thing to record — cannot be stored there.
--   * audit_logs.userId cascades on user delete, which would erase an account's
--     security history exactly when someone had reason to erase it. Here the
--     reference is ON DELETE SET NULL, so the record outlives the account and
--     `identifier` preserves who it was.

CREATE TABLE IF NOT EXISTS "auth_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" text REFERENCES "user"("id") ON DELETE SET NULL,
  "identifier" text,
  "event" text NOT NULL,
  "outcome" text NOT NULL,
  "reason" text,
  "appScope" text,
  "ipAddress" text,
  "userAgent" text,
  "detail" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_events_created_idx" ON "auth_events" ("createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_events_identifier_idx" ON "auth_events" ("identifier","createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_events_user_idx" ON "auth_events" ("userId","createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_events_event_idx" ON "auth_events" ("event","createdAt");
