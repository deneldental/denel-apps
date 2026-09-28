-- Migration 0082: Better Auth rate-limit database storage
--
-- Replaces the in-memory rate limiter with a persistent Postgres-backed store.
-- Required for horizontal scaling — the previous in-memory map was per-process
-- and reset on every restart, so a single backend restart cleared all counters
-- and 2+ instances had divergent state.
--
-- Schema matches Better Auth's expected model: id (primary key), key (lookup),
-- count (request counter), lastRequest (epoch milliseconds).
--
-- Better Auth queries by `key` on every auth call — the index keeps these
-- lookups fast as the table grows.

CREATE TABLE IF NOT EXISTS "rateLimit" (
  "id" text PRIMARY KEY NOT NULL,
  "key" text,
  "count" integer,
  "lastRequest" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_key_idx" ON "rateLimit" ("key");
