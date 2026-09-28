-- Add banned field to user table for Better Auth admin plugin compatibility
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banned" BOOLEAN NOT NULL DEFAULT false;
