-- Create sequence for patient IDs if it doesn't exist
CREATE SEQUENCE IF NOT EXISTS patient_id_seq START WITH 1;

-- Set the sequence to start from the current max patient number
-- This ensures no conflicts with existing patient IDs
DO $$
DECLARE
    max_patient_num INTEGER;
BEGIN
    -- Extract the numeric part from existing patient IDs and find the max
    SELECT COALESCE(MAX(CAST(SUBSTRING("patientId" FROM '#FDM([0-9]+)') AS INTEGER)), 0)
    INTO max_patient_num
    FROM patients
    WHERE "patientId" IS NOT NULL AND "patientId" ~ '^#FDM[0-9]+$';
    
    -- Set the sequence to start from max + 1
    PERFORM setval('patient_id_seq', max_patient_num + 1, false);
END $$;
