-- Create pending_medical_records table
CREATE TABLE IF NOT EXISTS "pending_medical_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"doctorId" uuid NOT NULL,
	"appointmentId" uuid,
	"checkedInAt" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);

-- Add foreign key constraints
DO $$ BEGIN
 ALTER TABLE "pending_medical_records" ADD CONSTRAINT "pending_medical_records_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "pending_medical_records" ADD CONSTRAINT "pending_medical_records_doctorId_doctors_id_fk" FOREIGN KEY ("doctorId") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "pending_medical_records" ADD CONSTRAINT "pending_medical_records_appointmentId_appointments_id_fk" FOREIGN KEY ("appointmentId") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "idx_pending_medical_records_doctor" ON "pending_medical_records" ("doctorId");
CREATE INDEX IF NOT EXISTS "idx_pending_medical_records_patient" ON "pending_medical_records" ("patientId");
CREATE INDEX IF NOT EXISTS "idx_pending_medical_records_status" ON "pending_medical_records" ("status");
CREATE INDEX IF NOT EXISTS "idx_pending_medical_records_appointment" ON "pending_medical_records" ("appointmentId");
