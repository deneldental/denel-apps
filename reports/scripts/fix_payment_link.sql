-- INSTRUCTIONS:
-- 1. Replace 'John Doe' with the patient's name.
-- 2. Verify the amount (e.g., 500) to target the correct payment.
-- 3. Execute this script.

UPDATE "payments"
SET 
  "paymentPlanId" = (
    SELECT "id" 
    FROM "payment_plans" 
    WHERE "patientId" = (SELECT "id" FROM "patients" WHERE "name" ILIKE 'John Doe' LIMIT 1)
    AND "status" IN ('activated', 'outstanding') -- Looking for active OR outstanding plans
    AND "type" = 'flexible'     
    LIMIT 1
  ),
  "description" = 'Flexible Plan Payment (Fixed)'
WHERE 
  "patientId" = (SELECT "id" FROM "patients" WHERE "name" ILIKE 'John Doe' LIMIT 1)
  -- Target the specific payment by amount if needed
  -- AND "amount" = 500
  AND "paymentPlanId" IS NULL;

-- VERIFICATION
SELECT * FROM "payments"
WHERE 
  "patientId" = (SELECT "id" FROM "patients" WHERE "name" ILIKE 'John Doe' LIMIT 1)
  AND "paymentPlanId" IS NOT NULL;
