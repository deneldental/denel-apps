-- G08 (DENEL_FRAMADA_AUDIT_2026-10-25.md, Step 10, decision D11-G08): the payment-confirmation text
-- of the modern posting paths (Receive Payment's draft → post, the estimate confirm) goes out at most
-- once per payment event.
--
-- One row per payment event texted: a payment, or a group of payments split across methods. Its
-- dedupe key ("payment:<id>" or "group:<paymentGroupId>") is claimed with INSERT … ON CONFLICT DO
-- NOTHING before the text is sent, so a replayed post, a retried request or two requests at once
-- can never text the patient twice. The row then records what the text named and how it went
-- ('sending' → 'sent' | 'failed', with the reason); a failed text is not sent again by itself.
--
-- SCHEMA ONLY: nothing is backfilled, and no payment is texted by this migration. Idempotent:
-- CREATE TABLE / CREATE UNIQUE INDEX IF NOT EXISTS, and the FKs guarded by the DO-blocks'
-- duplicate_object catch.

CREATE TABLE IF NOT EXISTS "payment_sms_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupeKey" text NOT NULL,
	"paymentId" uuid,
	"patientId" uuid NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"error" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"sentAt" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_sms_sends" ADD CONSTRAINT "payment_sms_sends_payment_id_fk" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_sms_sends" ADD CONSTRAINT "payment_sms_sends_patient_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_sms_sends_dedupe_key_uniq"
  ON "payment_sms_sends" ("dedupeKey");
