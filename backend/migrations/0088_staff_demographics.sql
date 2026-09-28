-- Staff gender and salary band for diversity and compensation analytics.

ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "gender" text;
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "salaryBand" text;
