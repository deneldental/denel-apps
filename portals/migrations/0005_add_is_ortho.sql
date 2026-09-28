-- Add isOrtho column to patients table
ALTER TABLE "patients" ADD COLUMN "isOrtho" boolean DEFAULT false NOT NULL;
