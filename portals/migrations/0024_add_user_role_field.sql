-- Add role field to user table for Better Auth compatibility
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" TEXT;
