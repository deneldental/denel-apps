CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"ip" text NOT NULL,
	"success" boolean NOT NULL,
	"attemptedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "emailVerified" SET DEFAULT false;--> statement-breakpoint
CREATE INDEX "login_attempts_identifier_at_idx" ON "login_attempts" USING btree ("identifier","attemptedAt");--> statement-breakpoint
ALTER TABLE "appointments" DROP COLUMN "clinicId";--> statement-breakpoint
ALTER TABLE "inventory" DROP COLUMN "clinicId";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "clinicId";--> statement-breakpoint
ALTER TABLE "lab_cases" DROP COLUMN "clinicId";--> statement-breakpoint
ALTER TABLE "medical_records" DROP COLUMN "clinicId";--> statement-breakpoint
ALTER TABLE "patient_wallets" DROP COLUMN "clinicId";--> statement-breakpoint
ALTER TABLE "patients" DROP COLUMN "clinicId";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "clinicId";--> statement-breakpoint
ALTER TABLE "staff" DROP COLUMN "clinicId";