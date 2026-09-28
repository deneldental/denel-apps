-- Migration 0027: Web Push subscriptions

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"      TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "endpoint"    TEXT NOT NULL UNIQUE,
  "p256dh"      TEXT NOT NULL,
  "auth"        TEXT NOT NULL,
  "userAgent"   TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "lastUsedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions"("userId");
