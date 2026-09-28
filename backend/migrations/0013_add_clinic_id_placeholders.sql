ALTER TABLE "appointments" ADD COLUMN "clinicId" text DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "clinicId" text DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "clinicId" text DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "lab_cases" ADD COLUMN "clinicId" text DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "medical_records" ADD COLUMN "clinicId" text DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "patient_wallets" ADD COLUMN "clinicId" text DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "clinicId" text DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "clinicId" text DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "clinicId" text DEFAULT 'default';