CREATE TABLE IF NOT EXISTS "document_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "description" text,
  "pdfUrl" text NOT NULL,
  "fields" jsonb DEFAULT '[]' NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdById" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_instances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "templateId" uuid,
  "title" text NOT NULL,
  "subjectType" text NOT NULL,
  "subjectId" uuid NOT NULL,
  "mode" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "signedPdfUrl" text,
  "contentHash" text,
  "fieldValues" jsonb,
  "signers" jsonb,
  "createdById" text,
  "completedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "document_instances" ADD CONSTRAINT "document_instances_templateId_document_templates_id_fk" FOREIGN KEY ("templateId") REFERENCES "document_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "document_instances" ADD CONSTRAINT "document_instances_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_instances_subject_idx" ON "document_instances" ("subjectType", "subjectId");
