-- admin-v1 F3/F4 — WHT credit certificates + CIT installment tracking.
--
-- F3: when the clinic withholds tax (WHT) on contractor/specialist payments it
-- must issue a WHT certificate to the payee and record the certificate for its
-- own CIT credit claim. wht_credit_certificates tracks every certificate.
--
-- F4: CIT installments are quarterly advance payments of corporate income tax
-- owed to GRA. cit_installments tracks each installment and links to the GL
-- journal entry that records the payment.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "wht_credit_certificates" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who the WHT was deducted from (specialist or external supplier).
  "partyType"       text NOT NULL, -- 'specialist' | 'supplier'
  "partyId"         uuid NOT NULL,
  -- Tax period the certificate belongs to.
  "taxYear"         integer NOT NULL,
  "taxMonth"        integer,        -- 1–12; null = annual cert
  -- Certificate details.
  "certificateRef"  text,
  "grossAmount"     numeric(15,2) NOT NULL,
  "whtRate"         numeric(5,4) NOT NULL,
  "whtAmount"       numeric(15,2) NOT NULL,
  -- GL linkage — the journal entry that booked the WHT payable.
  "journalEntryId"  uuid,
  "issuedAt"        timestamp,
  "remittedAt"      timestamp,      -- when the WHT was paid to GRA
  "notes"           text,
  "createdById"     text,
  "createdAt"       timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "wht_certs_party_year_idx"
  ON "wht_credit_certificates" ("partyType", "partyId", "taxYear");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "cit_installments" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "taxYear"         integer NOT NULL,
  "quarter"         integer NOT NULL CHECK ("quarter" BETWEEN 1 AND 4),
  "dueDate"         date NOT NULL,
  "estimatedAmount" numeric(15,2),
  "paidAmount"      numeric(15,2),
  "paidAt"          timestamp,
  -- GL journal entry that recorded the payment (DR CIT Installment Payable / CR Bank).
  "journalEntryId"  uuid,
  "notes"           text,
  "createdById"     text,
  "createdAt"       timestamp NOT NULL DEFAULT now(),
  UNIQUE ("taxYear", "quarter")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "cit_installments_year_idx"
  ON "cit_installments" ("taxYear");
