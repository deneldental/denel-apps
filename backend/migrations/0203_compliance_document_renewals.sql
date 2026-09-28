CREATE TABLE IF NOT EXISTS "compliance_document_renewals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documentId" uuid NOT NULL,
	"documentUrl" text NOT NULL,
	"receiptUrl" text,
	"amountPaid" numeric(12, 2),
	"expiryDate" timestamp NOT NULL,
	"notes" text,
	"uploadedById" text,
	"uploadedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance_document_renewals" ADD CONSTRAINT "compliance_document_renewals_documentId_compliance_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."compliance_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance_document_renewals" ADD CONSTRAINT "compliance_document_renewals_uploadedById_user_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
