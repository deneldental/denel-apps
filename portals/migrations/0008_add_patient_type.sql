-- Add type column to patients table (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'patients' AND column_name = 'type'
    ) THEN
        ALTER TABLE "patients" ADD COLUMN "type" text DEFAULT 'general' NOT NULL;
    END IF;
END $$;
