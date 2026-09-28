CREATE TABLE IF NOT EXISTS "payment_plan_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"totalAmount" integer NOT NULL,
	"amountPerInstallment" integer NOT NULL,
	"paymentFrequency" text NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_plans" ADD COLUMN IF NOT EXISTS "templateId" uuid;
--> statement-breakpoint
ALTER TABLE "payment_plans" ADD COLUMN IF NOT EXISTS "amountPerInstallment" integer;
--> statement-breakpoint
ALTER TABLE "payment_plans" DROP COLUMN IF EXISTS "numberOfInstallments";
--> statement-breakpoint
ALTER TABLE "payment_plans" ALTER COLUMN "status" SET DEFAULT 'activated';
--> statement-breakpoint
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'payment_plans_templateId_payment_plan_templates_id_fk'
    ) THEN
        ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_templateId_payment_plan_templates_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."payment_plan_templates"("id") ON DELETE set null ON UPDATE no action;
    END IF;
END $$;
--> statement-breakpoint
-- Update existing payment plans to calculate amountPerInstallment
-- Note: numberOfInstallments column has been dropped, so this update is no longer needed
-- DO $$
-- BEGIN
--     UPDATE "payment_plans"
--     SET "amountPerInstallment" = ROUND("totalAmount" / NULLIF("numberOfInstallments", 0))
--     WHERE "amountPerInstallment" IS NULL AND "numberOfInstallments" IS NOT NULL;
-- END $$;
