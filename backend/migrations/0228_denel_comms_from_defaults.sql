-- Denel defaults for the SMS and email logs' `from` columns.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- Both columns still defaulted to the original template clinic: 'Framada' and
-- 'Framada Dental <clinic@framada.app>'. The app always writes `from`
-- (lib/sms.ts, lib/email.ts), so a default only applies to a row inserted by
-- hand — but it should name this clinic. The clinic's email address is
-- info@deneldental.com (decided 2026-09-25; see denel-rebrand-plan.md).
--
-- Idempotent.

ALTER TABLE sms_messages ALTER COLUMN "from" SET DEFAULT 'Denel';
--> statement-breakpoint
ALTER TABLE email_messages ALTER COLUMN "from" SET DEFAULT 'Denel Dental <info@deneldental.com>';
