-- admin-v1 §17.1/§17.2 — compliance documents.
-- §17.1: preserve the issuing-authority + notes fields the page UI already shows
--        (the mock had them; the table didn't) so the wired page keeps its UX.
-- §17.2: track the last renewal-reminder send so the auto-send job fires once per
--        renewal cycle (re-arms when a document's expiry is pushed out on renewal).
ALTER TABLE "compliance_documents" ADD COLUMN IF NOT EXISTS "issuingAuthority" text;
--> statement-breakpoint
ALTER TABLE "compliance_documents" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
ALTER TABLE "compliance_documents" ADD COLUMN IF NOT EXISTS "lastReminderSentAt" timestamp;
