-- INSTRUCTIONS:
-- 1. Replace 'John Doe' with the patient's name.
-- 2. Replace 500 with the amount (in GHS).
-- 3. Replace '2023-10-25 14:30:00' with your specific backdate.
-- 4. Execute this script in your Neon SQL editor.

INSERT INTO "payments" (
    "id",
    "patientId",
    "amount",
    "method",
    "status",
    "description",
    "createdAt",
    "sendNotification",
    "balance",
    "paymentPlanId",
    "appointmentId",
    "transactionId"
)
VALUES (
    gen_random_uuid(), -- 1. id
    (SELECT "id" FROM "patients" WHERE "name" ILIKE 'John Doe' LIMIT 1), -- 2. patientId
    500,               -- 3. amount
    'cash',            -- 4. method
    'completed',       -- 5. status
    'Manual Backdated Payment', -- 6. description
    '2023-10-25 14:30:00'::timestamp, -- 7. createdAt
    false,             -- 8. sendNotification
    0,                 -- 9. balance
    -- 10. paymentPlanId - Prioritize FLEXIBLE plans first
    (
        SELECT "id" FROM "payment_plans" 
        WHERE "patientId" = (SELECT "id" FROM "patients" WHERE "name" ILIKE 'John Doe' LIMIT 1)
        AND "status" IN ('activated', 'outstanding') -- Allow activated OR outstanding plans
        AND "type" = 'flexible' -- STRICTLY look for flexible plans
        LIMIT 1
    ),
    NULL,              -- 11. appointmentId
    NULL               -- 12. transactionId
);
