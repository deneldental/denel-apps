-- Add paymentPlanId column if it doesn't exist
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "paymentPlanId" uuid;

-- Add sendNotification column if it doesn't exist
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "sendNotification" boolean DEFAULT false NOT NULL;

-- Add foreign key constraint if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'payments_paymentPlanId_payment_plans_id_fk'
    ) THEN
        ALTER TABLE "payments" 
        ADD CONSTRAINT "payments_paymentPlanId_payment_plans_id_fk" 
        FOREIGN KEY ("paymentPlanId") 
        REFERENCES "public"."payment_plans"("id") 
        ON DELETE set null ON UPDATE no action;
    END IF;
END $$;
