-- Add new columns to patients table
ALTER TABLE "patients" ADD COLUMN "occupation" text;
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "profileImage" text;
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "isChild" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardianName" text;
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardianPhone" text;
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardianEmail" text;
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardianAddress" text;
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardianOccupation" text;
