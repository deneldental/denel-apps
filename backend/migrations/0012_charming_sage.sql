CREATE TABLE "patient_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"fromDate" timestamp NOT NULL,
	"toDate" timestamp NOT NULL,
	"fileKey" text NOT NULL,
	"generatedBy" text NOT NULL,
	"generatedAt" timestamp DEFAULT now() NOT NULL,
	"sizeBytes" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patient_statements" ADD CONSTRAINT "patient_statements_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_statements" ADD CONSTRAINT "patient_statements_generatedBy_user_id_fk" FOREIGN KEY ("generatedBy") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_patient_statements_patient" ON "patient_statements" USING btree ("patientId");--> statement-breakpoint
CREATE INDEX "idx_patient_statements_generated" ON "patient_statements" USING btree ("generatedAt" DESC NULLS LAST);