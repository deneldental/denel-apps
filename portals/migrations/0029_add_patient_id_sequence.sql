-- Create sequence for patient IDs
CREATE SEQUENCE IF NOT EXISTS patient_id_seq START WITH 1;

-- Add comment
COMMENT ON SEQUENCE patient_id_seq IS 'Sequence for generating unique patient IDs';
