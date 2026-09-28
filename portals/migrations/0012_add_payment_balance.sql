-- Add balance column to payments table to store balance at time of payment
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "balance" integer;
