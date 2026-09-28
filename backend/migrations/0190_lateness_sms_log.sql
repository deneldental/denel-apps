-- Lateness alert SMS tracking.
--
-- The weekly lateness-policy cron already texts staff who breach the late
-- threshold, but nothing recorded the outcome: `staff_lateness_queries` held
-- only the escalation level, and `sms_messages` is keyed on patient, so a
-- staff-directed alert could not be traced back to the query that caused it.
--
-- These columns make the send auditable per query row, which is what the HR
-- Lateness Log tab reads. Existing rows keep NULL "smsStatus" — meaning
-- "issued before tracking existed", rendered as unknown rather than failed.

ALTER TABLE "staff_lateness_queries" ADD COLUMN IF NOT EXISTS "smsStatus" text;
ALTER TABLE "staff_lateness_queries" ADD COLUMN IF NOT EXISTS "smsSentAt" timestamp;
ALTER TABLE "staff_lateness_queries" ADD COLUMN IF NOT EXISTS "smsRecipient" text;
ALTER TABLE "staff_lateness_queries" ADD COLUMN IF NOT EXISTS "smsMessage" text;
ALTER TABLE "staff_lateness_queries" ADD COLUMN IF NOT EXISTS "smsError" text;

-- The log lists newest-first across all staff; the existing index is staff-only.
CREATE INDEX IF NOT EXISTS "staff_lateness_queries_week_idx"
  ON "staff_lateness_queries" ("weekStart" DESC);
