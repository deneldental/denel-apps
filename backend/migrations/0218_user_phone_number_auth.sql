-- Better Auth `phoneNumber` plugin — the two columns it requires on `user`.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- Stage 1 of project-docs/auth-consolidation-plan.md: retire the hand-rolled
-- staff session/OTP stack (lib/staff-session.ts + lib/staff-otp.ts) in favour
-- of Better Auth's phone-number plugin, so the Team PWA's passwordless login
-- produces a real Better Auth session — one revocation path, one place a ban
-- is enforced, and `hooks.after` firing for the session cache.
--
-- This migration is ADDITIVE and switches nothing over. The custom stack still
-- serves every login until stage 2.
--
-- ─── Why a separate column and not `user.phone` ────────────────────────
-- `phone` already exists and is declared as a Better Auth `additionalField`;
-- the HR app reads it off the session (pages/trainer/ProfilePage.tsx). The
-- plugin can be pointed at an existing column via its `schema` option, but
-- that would put two logical fields on one column, and a user update carrying
-- both would clobber one with the other.
--
-- DRIFT RISK while both columns exist: anywhere `user.phone` is synced from
-- `staff.phone` must write BOTH, or a staffer changes their number and can no
-- longer sign in. Stage 4 collapses them.
--
-- ─── Uniqueness ────────────────────────────────────────────────────────
-- The plugin declares `phoneNumber` unique — it is the login identifier, so a
-- duplicate would make the lookup ambiguous. Verified safe before applying:
-- `src/scripts/audit-staff-phones.ts` reports duplicate groups, and the column
-- starts empty in any case. Postgres unique indexes permit multiple NULLs, so
-- staff without a phone are unaffected.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phoneNumber" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phoneNumberVerified" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_phoneNumber_unique" ON "user" ("phoneNumber");
