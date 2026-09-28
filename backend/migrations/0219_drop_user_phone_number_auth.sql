-- Reverses 0215: drops the Better Auth `phoneNumber` plugin's columns.
--
-- ─── Why ───────────────────────────────────────────────────────────────
-- The plugin was registered in stage 1 of the auth consolidation and never
-- adopted. Stage 2 established that it CANNOT serve this clinic's staff login:
-- its own /phone-number/send-otp texts any number given to it, whereas
-- routes/staff-auth.ts must first resolve an active, non-deleted staff record
-- (no SMS to unknown numbers, no enumeration). So staff-auth kept owning the
-- OTP and only session creation moved to the kernel, via the server-session
-- plugin. Every OTP goes to `staff_otp_codes`; `verification` stayed empty.
--
-- Leaving the plugin registered was actively harmful rather than merely dead:
-- Better Auth mounts every plugin endpoint under /api/auth/*, so it published
-- an unauthenticated POST /api/auth/phone-number/send-otp that sent an SMS to
-- any number at the clinic's expense, uncapped whenever Better Auth's IP rate
-- limiter could not resolve a client address. Removed 2026-09-21; these
-- columns go with it.
--
-- Safe to drop: nothing ever wrote them outside the plugin, and the unique
-- index was only ever needed as the plugin's login identifier. `user.phone`
-- is untouched and remains the column the HR app reads off the session.

DROP INDEX IF EXISTS "user_phoneNumber_unique";
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN IF EXISTS "phoneNumber";
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN IF EXISTS "phoneNumberVerified";
