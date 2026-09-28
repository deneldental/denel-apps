-- Add additionalNote column to daily_reports table
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS "additionalNote" TEXT;

-- Add comment
COMMENT ON COLUMN daily_reports."additionalNote" IS 'Note about who we owe when expenses exceed payments';
