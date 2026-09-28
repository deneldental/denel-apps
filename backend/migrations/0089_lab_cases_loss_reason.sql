-- Loss reason on lab cases for root-cause analysis of rework and scrap.

ALTER TABLE "lab_cases" ADD COLUMN IF NOT EXISTS "lossReason" text;
