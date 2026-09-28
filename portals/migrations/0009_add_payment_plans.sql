CREATE TABLE IF NOT EXISTS "payment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"totalAmount" integer NOT NULL,
	"numberOfInstallments" integer NOT NULL,
	"paymentFrequency" text NOT NULL,
	"startDate" timestamp NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_plans_patientId_unique" UNIQUE("patientId")
);
--> statement-breakpoint
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'payment_plans_patientId_patients_id_fk'
    ) THEN
        ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;
