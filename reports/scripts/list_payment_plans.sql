-- INSTRUCTIONS:
-- 1. Replace 'John Doe' with the patient's name.
-- 2. Execute the script in Neon.
-- 3. Share the results with me.

SELECT 
    pp.id,
    pp."patientId",
    p.name AS "patientName",
    pp.status,
    pp.type,
    pp."totalAmount",
    pp."amountPerInstallment",
    pp."createdAt",
    pp."startDate"
FROM "payment_plans" pp
JOIN "patients" p ON pp."patientId" = p.id
WHERE 
    p.name ILIKE 'John Doe';
