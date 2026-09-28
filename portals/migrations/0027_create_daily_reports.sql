-- Create daily reports table
CREATE TABLE IF NOT EXISTS "daily_reports" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "reportDate" timestamp NOT NULL,
    "checkedInCount" integer NOT NULL,
    "newPatientsCount" integer NOT NULL,
    "totalPayments" integer NOT NULL,
    "totalExpenses" integer NOT NULL,
    "balances" jsonb NOT NULL,
    "submittedById" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "createdAt" timestamp NOT NULL DEFAULT now()
);
